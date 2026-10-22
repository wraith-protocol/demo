import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { DEFAULT_SCAN_STRATEGY, type ScanStrategy } from '../workers/stellarScanDispatch';
import { findMatches } from '../workers/stellarScanMatch';
import {
  isScanKeyUnlocked,
  openScanKey,
  wipeScanKeyMaterial,
  type ScanKeyBackend,
} from './scanKeyStore';

/** What leaves the scanner on a match: no keys, no scalars. */
export interface BackgroundMatch {
  publicKey: string;
  stealthAddress: string;
}

export interface PageScannerDeps {
  backend: ScanKeyBackend;
  publicKey: string;
  notifyMatch: (match: BackgroundMatch) => Promise<void>;
  strategy?: ScanStrategy;
}

export interface PageScanner {
  /**
   * Matches one page and notifies. Resolves true when the page was handled, false when
   * the key was locked or removed first. On false the caller must NOT advance its durable
   * scan cursor past this page.
   */
  scanPage(announcements: Announcement[]): Promise<boolean>;
  /** Wipes the in-memory key material. Always call when done. */
  close(): void;
}

export type OpenPageScannerResult =
  | { status: 'ready'; scanner: PageScanner }
  | { status: 'locked' | 'missing' | 'invalid' };

/**
 * Opens the sealed scan key. Holds no state beyond the returned scanner: lock, restart
 * and removal all take effect because the key is re-read from storage on every open.
 */
export async function openPageScanner(deps: PageScannerDeps): Promise<OpenPageScannerResult> {
  const opened = await openScanKey(deps.backend, deps.publicKey);
  if (opened.status !== 'ok') return { status: opened.status };
  const { material } = opened;
  let closed = false;

  return {
    status: 'ready',
    scanner: {
      async scanPage(announcements) {
        if (closed) return false;
        // The key may have been locked or removed since the previous page.
        if (!(await isScanKeyUnlocked(deps.backend, deps.publicKey))) return false;
        const found = findMatches(
          deps.strategy ?? DEFAULT_SCAN_STRATEGY,
          announcements,
          material.viewingKey,
          material.spendingPubKey,
        );
        for (const match of found) {
          await deps.notifyMatch({
            publicKey: deps.publicKey,
            stealthAddress: match.stealthAddress,
          });
        }
        return true;
      },
      close() {
        if (closed) return;
        closed = true;
        wipeScanKeyMaterial(material);
      },
    },
  };
}

export interface ScanPage {
  announcements: Announcement[];
  /** Highest ledger proven fully read; the cursor to persist is committedLedger + 1. */
  committedLedger: number;
}

export type ScanPagesResult = { status: 'scanned' } | { status: 'locked' | 'missing' | 'invalid' };

class ScanKeyUnavailableError extends Error {
  constructor() {
    super('Scan key was locked or removed during the scan');
    this.name = 'ScanKeyUnavailableError';
  }
}

/**
 * One background scan. The key is opened first, so a locked or unregistered account costs
 * no network. Each page is matched and notified BEFORE its cursor is committed, so a
 * payment can never be skipped by the cursor; a lock between pages stops the scan without
 * committing the unread page. Notification is at-least-once: a failure after notifying but
 * before committing re-notifies on the next scan (notifications are tagged per address).
 */
export async function scanPages(
  deps: PageScannerDeps & {
    readPages: (onPage: (page: ScanPage) => Promise<void>) => Promise<unknown>;
    commit: (nextLedger: number) => Promise<void>;
  },
): Promise<ScanPagesResult> {
  const opened = await openPageScanner(deps);
  if (opened.status !== 'ready') return { status: opened.status };
  const { scanner } = opened;

  try {
    await deps.readPages(async (page) => {
      if (!(await scanner.scanPage(page.announcements))) throw new ScanKeyUnavailableError();
      await deps.commit(page.committedLedger + 1);
    });
    return { status: 'scanned' };
  } catch (error) {
    if (error instanceof ScanKeyUnavailableError) return { status: 'locked' };
    throw error;
  } finally {
    scanner.close();
  }
}

// ─── notification ────────────────────────────────────────────────────────────

export interface MatchNotificationOptions {
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: { id: string; stealthAddress: string; timestamp: number; url: string };
}

export interface MatchNotifier {
  showNotification(title: string, options: MatchNotificationOptions): Promise<void>;
  broadcast(message: unknown): Promise<void>;
}

export function buildMatchNotification(match: BackgroundMatch, now = Date.now()) {
  const id = `match:${match.stealthAddress}`;
  const options: MatchNotificationOptions = {
    body: 'A new stealth payment matched your account. Open Wraith to claim it.',
    icon: '/favicon-32x32.png',
    badge: '/favicon-16x16.png',
    tag: id,
    data: { id, stealthAddress: match.stealthAddress, timestamp: now, url: '/notifications' },
  };
  return { title: 'Payment received', options };
}

export async function deliverMatch(notifier: MatchNotifier, match: BackgroundMatch) {
  const { title, options } = buildMatchNotification(match);
  try {
    await notifier.showNotification(title, options);
  } catch (error) {
    console.warn('[wraith-sw] Could not show match notification:', error);
  }
  await notifier.broadcast({
    type: 'STELLAR_PAYMENT_MATCH',
    publicKey: match.publicKey,
    stealthAddress: match.stealthAddress,
  });
}
