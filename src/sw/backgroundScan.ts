import { scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { parseAnnouncementEvent } from '../lib/stellar/announcementEvent';
import {
  ViewingKeyError,
  openViewingMaterial,
  type StoredMatch,
  type StoredViewingKey,
} from '../lib/stellar/backgroundKeys';
import { HttpError, withRetry, type RetryOptions } from '../lib/stellar/retry';

const PAGE_SIZE = 1000;
/** First-ever scan looks back this many ledgers, matching the foreground scan. */
const INITIAL_LOOKBACK_LEDGERS = 5000;

export interface ScanCommit {
  /** Ledger up to and including which every event has been processed. */
  lastScannedLedger?: number;
  newMatches: StoredMatch[];
}

export interface ScanStore {
  list(): Promise<StoredViewingKey[]>;
  /**
   * Persists matches and the cursor together, atomically. Implementations merge
   * `newMatches` into what is already stored (skipping repeats) and never move
   * the cursor backwards.
   */
  commit(publicKey: string, commit: ScanCommit): Promise<void>;
}

export interface BackgroundScanOptions {
  store: ScanStore;
  rpcUrl: string;
  contractId: string;
  retry?: RetryOptions;
  now?: () => number;
}

export type ScanOutcome =
  | { publicKey: string; status: 'ok'; newMatches: StoredMatch[]; lastScannedLedger?: number }
  | { publicKey: string; status: 'key-error'; code: ViewingKeyError['code']; message: string }
  | { publicKey: string; status: 'error'; message: string };

interface FetchedEvents {
  events: Record<string, unknown>[];
  latestLedger?: number;
}

class LedgerRangeError extends Error {
  constructor(
    public readonly oldest: number,
    public readonly latest: number,
  ) {
    super(`startLedger outside retained range ${oldest}-${latest}`);
    this.name = 'LedgerRangeError';
  }
}

async function rpcGetEvents(
  rpcUrl: string,
  params: Record<string, unknown>,
  retry?: RetryOptions,
): Promise<{ events?: Record<string, unknown>[]; latestLedger?: number; cursor?: string }> {
  return withRetry(async () => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
    });
    if (!response.ok) throw new HttpError(response.status, `RPC responded ${response.status}`);

    const data = await response.json();
    if (data.error) {
      const message = String(data.error.message ?? 'RPC error');
      const range = message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (range) throw new LedgerRangeError(parseInt(range[1], 10), parseInt(range[2], 10));
      throw new Error(message);
    }
    return data.result ?? {};
  }, retry);
}

/**
 * Fetches every announcer event from `startLedger`, following pagination. Any
 * failure throws — a partial or empty result is never returned for an error,
 * otherwise the caller would advance its cursor past events it never saw.
 */
export async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string,
  startLedger: number | undefined,
  retry?: RetryOptions,
): Promise<FetchedEvents> {
  const events: Record<string, unknown>[] = [];
  const filters = [{ type: 'contract', contractIds: [contractId] }];
  let start = startLedger ?? 1;
  let cursor: string | undefined;
  let latestLedger: number | undefined;
  let rangeAdjusted = false;

  for (;;) {
    const params: Record<string, unknown> = cursor
      ? { filters, pagination: { limit: PAGE_SIZE, cursor } }
      : { filters, startLedger: start, pagination: { limit: PAGE_SIZE } };

    let result;
    try {
      result = await rpcGetEvents(rpcUrl, params, retry);
    } catch (error) {
      if (error instanceof LedgerRangeError && !cursor && !rangeAdjusted) {
        // The RPC only retains recent ledgers. A stale cursor resumes from the
        // oldest retained ledger; a first scan is capped like the foreground.
        start =
          startLedger === undefined
            ? Math.max(error.oldest, error.latest - INITIAL_LOOKBACK_LEDGERS)
            : error.oldest;
        rangeAdjusted = true;
        continue;
      }
      throw error;
    }

    const page = result.events ?? [];
    events.push(...page);
    if (typeof result.latestLedger === 'number') latestLedger = result.latestLedger;

    if (page.length < PAGE_SIZE || !result.cursor) break;
    cursor = result.cursor;
  }

  return { events, latestLedger };
}

function announcementKey(ann: Pick<Announcement, 'stealthAddress' | 'ephemeralPubKey'>): string {
  return `${ann.stealthAddress}:${ann.ephemeralPubKey}`;
}

/**
 * Parses with the same parser as the foreground scan, dropping malformed events
 * and repeats. The same announcement can arrive twice: the cursor is inclusive
 * of the last scanned ledger, and RPC pages can overlap.
 */
function parseEvents(events: Record<string, unknown>[]): {
  announcements: Announcement[];
  ledgers: Map<string, number>;
} {
  const announcements: Announcement[] = [];
  const ledgers = new Map<string, number>();
  const seen = new Set<string>();

  for (const event of events) {
    let ann: Announcement | null;
    try {
      ann = parseAnnouncementEvent(event);
    } catch {
      continue;
    }
    if (!ann) continue;

    const key = announcementKey(ann);
    if (seen.has(key)) continue;
    seen.add(key);
    announcements.push(ann);
    if (typeof event.ledger === 'number') ledgers.set(key, event.ledger);
  }

  return { announcements, ledgers };
}

async function scanOne(
  record: StoredViewingKey,
  options: BackgroundScanOptions,
): Promise<ScanOutcome> {
  const { publicKey } = record;
  const now = options.now ?? Date.now;

  let material;
  try {
    material = await openViewingMaterial(record);
  } catch (error) {
    if (error instanceof ViewingKeyError) {
      return { publicKey, status: 'key-error', code: error.code, message: error.message };
    }
    throw error;
  }

  try {
    const { events, latestLedger } = await fetchAnnouncementEvents(
      options.rpcUrl,
      options.contractId,
      record.lastScannedLedger,
      options.retry,
    );

    const { announcements, ledgers } = parseEvents(events);
    const matched = scanAnnouncements(
      announcements,
      material.viewingKey,
      material.spendingPubKey,
      material.spendingScalar,
    );

    const known = new Set((record.matches ?? []).map(announcementKey));
    const newMatches: StoredMatch[] = [];
    for (const m of matched) {
      const key = announcementKey(m);
      if (known.has(key)) continue;
      known.add(key);
      const ledger = ledgers.get(key);
      newMatches.push({
        stealthAddress: m.stealthAddress,
        ephemeralPubKey: m.ephemeralPubKey,
        caller: m.caller,
        schemeId: m.schemeId,
        ...(ledger !== undefined ? { ledger } : {}),
        detectedAt: now(),
      });
    }

    // Without a ledger from the RPC the cursor stays where it is.
    const lastScannedLedger = latestLedger;
    await options.store.commit(publicKey, { lastScannedLedger, newMatches });

    return { publicKey, status: 'ok', newMatches, lastScannedLedger };
  } catch (error) {
    return {
      publicKey,
      status: 'error',
      message: error instanceof Error ? error.message : 'Background scan failed',
    };
  }
}

/**
 * Scans every registered viewing key. A failure on one key never blocks the
 * others, and a key's cursor only moves once its matches are persisted.
 */
export async function runBackgroundScan(options: BackgroundScanOptions): Promise<ScanOutcome[]> {
  // Push-subscription-only entries carry no viewing material, so there is nothing to scan.
  const records = (await options.store.list()).filter((record) => record.encryptedViewingKey);
  const outcomes: ScanOutcome[] = [];
  for (const record of records) {
    outcomes.push(await scanOne(record, options));
  }
  return outcomes;
}
