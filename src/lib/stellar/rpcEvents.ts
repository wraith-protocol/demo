/**
 * Lossless Soroban `getEvents` pagination over Stellar RPC.
 *
 * Every component that scans the announcer contract — the page-side scanner
 * worker, the service worker's background sync and the SDK-backed scanner —
 * reads events through this module so there is exactly one implementation of
 * the cursor rules:
 *
 * 1. Pages are followed with the RPC's `pagination.cursor` until either the
 *    committed boundary or the end of the window is reached. The 1,000-event
 *    per-call cap is a page size, never a scan size.
 * 2. Progress is persisted through `onPage`, which is awaited after every page
 *    that was successfully fetched *and* handed to the caller. A scan that
 *    dies mid-way therefore resumes from the first unread ledger instead of
 *    jumping to the tip. Because a page boundary can split a single ledger
 *    across two pages, the last ledger a page delivered is only committed once
 *    a later page proves it was read to the end.
 * 3. Requests are abortable and time-bounded, HTTP status is checked before the
 *    body is read, and every JSON-RPC envelope/result is shape-validated before
 *    it is trusted.
 *
 * This module deliberately has no Stellar SDK imports so it can be bundled into
 * the service worker without pulling in XDR parsing; decoding event payloads
 * into announcements lives in `announcementRpc.ts`.
 */
import {
  retentionErrorFromRpcMessage,
  parseLedgerWindow,
  StellarRetentionExceededError,
} from './scannerCursor';

/** Ceiling for a single RPC round-trip. */
export const DEFAULT_RPC_TIMEOUT_MS = 15_000;
/** Page size requested from `getEvents`. The RPC caps responses at this value. */
export const DEFAULT_EVENTS_PAGE_LIMIT = 1_000;
/** How far back a first scan reaches when the RPC serves the full history. */
export const DEFAULT_EVENT_LOOKBACK_LEDGERS = 5_000;
/** Safety stop for pagination loops; a healthy scan needs far fewer pages. */
export const MAX_EVENT_PAGES = 1_000;

export class StellarRpcHttpError extends Error {
  readonly status: number;
  readonly method: string;

  constructor(rpcUrl: string, method: string, status: number, statusText: string) {
    super(
      `Stellar RPC ${method} at ${rpcUrl} failed with HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
    );
    this.name = 'StellarRpcHttpError';
    this.status = status;
    this.method = method;
  }
}

export class StellarRpcTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly method: string;

  constructor(rpcUrl: string, method: string, timeoutMs: number) {
    super(`Stellar RPC ${method} at ${rpcUrl} timed out after ${timeoutMs}ms`);
    this.name = 'StellarRpcTimeoutError';
    this.timeoutMs = timeoutMs;
    this.method = method;
  }
}

export class StellarRpcResponseError extends Error {
  readonly method: string;

  constructor(method: string, message: string) {
    super(`Stellar RPC ${method} returned an invalid response: ${message}`);
    this.name = 'StellarRpcResponseError';
    this.method = method;
  }
}

/** A JSON-RPC `error` object returned by the RPC with a 2xx status. */
export class StellarRpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'StellarRpcError';
    this.code = code;
  }
}

/** A shape-validated `getEvents` entry. */
export interface StellarRpcEvent {
  /** Base64-encoded `ScVal` topics. */
  topic: string[];
  /** Base64-encoded `ScVal` value. */
  value: string;
  /** Ledger the event was emitted in — the unit the scan cursor is kept in. */
  ledger?: number;
  contractId?: string;
}

export interface StellarRpcOptions {
  /** Per-request timeout in milliseconds. Defaults to `DEFAULT_RPC_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Caller-owned abort signal, combined with the per-request timeout. */
  signal?: AbortSignal;
}

/** A fully processed page, handed to `onPage` before the next request is made. */
export interface EventsPage {
  /** 1-based page index within this scan. */
  page: number;
  events: StellarRpcEvent[];
  /** Entries dropped because they were not a valid `getEvents` event. */
  malformedEvents: number;
  /**
   * Highest ledger proven fully consumed by this scan, including earlier pages.
   * Safe to persist as `committedLedger + 1`: the ledger the RPC cursor stopped
   * in is deliberately excluded while more events may still follow in it.
   */
  committedLedger: number;
}

export interface FetchEventPagesOptions extends StellarRpcOptions {
  rpcUrl: string;
  contractId: string;
  /** Ledger to resume from. Defaults to the edge of the retention window. */
  startLedger?: number;
  /** Ledger the scan must not read past. Defaults to the tip at scan start. */
  throughLedger?: number;
  /**
   * RPC event filters. Defaults to every event from `contractId`; contracts that
   * only care about specific topics pass their own filter list.
   */
  filters?: unknown[];
  /** Page size. Defaults to `DEFAULT_EVENTS_PAGE_LIMIT`. */
  pageLimit?: number;
  /** Look-back window for a first scan. Defaults to `DEFAULT_EVENT_LOOKBACK_LEDGERS`. */
  lookbackLedgers?: number;
  /** Safety stop for the pagination loop. Defaults to `MAX_EVENT_PAGES`. */
  maxPages?: number;
  /**
   * Awaited after each successfully processed page. Persisting
   * `committedLedger + 1` here is what makes an interrupted scan lossless; a
   * resume may re-read the last ledger the page touched, but never skips past
   * events that page had not delivered yet.
   */
  onPage?: (page: EventsPage) => void | Promise<void>;
}

export interface FetchEventPagesResult {
  events: StellarRpcEvent[];
  /**
   * Ledger the next scan resumes from: one past `committedLedger`. It can point
   * back into a ledger that was only partly delivered if the scan stopped there.
   */
  nextLedger: number;
  /** Highest ledger fully processed by this scan. */
  committedLedger: number;
  /** Boundary this scan was clamped to. */
  throughLedger: number;
  pages: number;
  /** True when `maxPages` stopped the scan before the boundary. */
  truncated: boolean;
  malformedEvents: number;
}

interface GetEventsPage {
  events: StellarRpcEvent[];
  cursor?: string;
  latestLedger?: number;
  malformedEvents: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Ledger encoded in a Soroban event cursor ("<19-digit TOID>-<event index>"): the TOID's
 * high 32 bits are the ledger sequence. Undefined for any other cursor shape.
 */
function cursorLedger(cursor: string): number | undefined {
  const match = /^(\d{1,19})-\d+$/.exec(cursor);
  if (!match) return undefined;
  const ledger = BigInt(match[1]) >> 32n;
  return ledger <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ledger) : undefined;
}

function validateEvent(raw: unknown): StellarRpcEvent | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.value !== 'string') return undefined;
  if (!Array.isArray(raw.topic) || raw.topic.some((topic) => typeof topic !== 'string')) {
    return undefined;
  }

  const event: StellarRpcEvent = { topic: raw.topic as string[], value: raw.value };
  if (typeof raw.ledger === 'number' && Number.isSafeInteger(raw.ledger) && raw.ledger > 0) {
    event.ledger = raw.ledger;
  }
  if (typeof raw.contractId === 'string') {
    event.contractId = raw.contractId;
  }
  return event;
}

function validateEventsPage(result: unknown): GetEventsPage {
  if (!isRecord(result)) {
    throw new StellarRpcResponseError('getEvents', 'result was not an object');
  }
  if (!Array.isArray(result.events)) {
    throw new StellarRpcResponseError('getEvents', 'result.events was not an array');
  }

  const events: StellarRpcEvent[] = [];
  let malformedEvents = 0;
  for (const raw of result.events) {
    const event = validateEvent(raw);
    if (event) {
      events.push(event);
    } else {
      malformedEvents += 1;
    }
  }

  const page: GetEventsPage = { events, malformedEvents };
  if (typeof result.cursor === 'string' && result.cursor.length > 0) {
    page.cursor = result.cursor;
  }
  if (typeof result.latestLedger === 'number' && Number.isSafeInteger(result.latestLedger)) {
    page.latestLedger = result.latestLedger;
  }
  return page;
}

function unwrapJsonRpcResult(payload: unknown, method: string): unknown {
  if (!isRecord(payload)) {
    throw new StellarRpcResponseError(method, 'body was not a JSON object');
  }
  if (payload.jsonrpc !== undefined && payload.jsonrpc !== '2.0') {
    throw new StellarRpcResponseError(method, 'jsonrpc version was not "2.0"');
  }
  if (payload.error !== undefined && payload.error !== null) {
    const error = payload.error;
    const message =
      isRecord(error) && typeof error.message === 'string'
        ? error.message
        : `${method} rejected the request without a message`;
    const code =
      isRecord(error) && typeof error.code === 'number' ? (error.code as number) : undefined;
    throw new StellarRpcError(message, code);
  }
  if (payload.result === undefined || payload.result === null) {
    throw new StellarRpcResponseError(method, 'body did not contain a result');
  }
  return payload.result;
}

/**
 * One validated, time-bounded JSON-RPC call. Network, HTTP, envelope and shape
 * failures all surface as typed errors so callers can tell an outage (retry
 * later, keep the cursor) from a retention gap (recover the cursor).
 */
async function postJsonRpc(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown> | undefined,
  options: StellarRpcOptions,
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller);
  if (options.signal?.aborted) controller.abort();

  try {
    let response: Response;
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new StellarRpcTimeoutError(rpcUrl, method, timeoutMs);
      throw error;
    }

    if (!response.ok) {
      throw new StellarRpcHttpError(rpcUrl, method, response.status, response.statusText);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new StellarRpcResponseError(method, 'body was not valid JSON');
    }

    return unwrapJsonRpcResult(payload, method);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Reads the current tip. Throws when the RPC omits a usable sequence. */
export async function fetchLatestLedger(
  rpcUrl: string,
  options: StellarRpcOptions = {},
): Promise<number> {
  const result = await postJsonRpc(rpcUrl, 'getLatestLedger', undefined, options);
  const sequence = isRecord(result) ? result.sequence : undefined;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new StellarRpcResponseError('getLatestLedger', 'result.sequence was not a ledger number');
  }
  return sequence;
}

function eventParams(
  filters: unknown[],
  pageLimit: number,
  position: { startLedger: number } | { cursor: string },
): Record<string, unknown> {
  const pagination: Record<string, unknown> = { limit: pageLimit };
  if ('cursor' in position) pagination.cursor = position.cursor;
  return {
    ...('startLedger' in position ? { startLedger: position.startLedger } : {}),
    filters,
    pagination,
  };
}

async function getEventsPage(
  rpcUrl: string,
  filters: unknown[],
  pageLimit: number,
  position: { startLedger: number } | { cursor: string },
  options: StellarRpcOptions,
  /** When set, a range error is mapped to a retention error for this cursor. */
  retentionLedger?: number,
): Promise<GetEventsPage> {
  try {
    const result = await postJsonRpc(
      rpcUrl,
      'getEvents',
      eventParams(filters, pageLimit, position),
      options,
    );
    return validateEventsPage(result);
  } catch (error) {
    if (retentionLedger !== undefined && error instanceof StellarRpcError) {
      const retentionError = retentionErrorFromRpcMessage(retentionLedger, error.message);
      if (retentionError) throw retentionError;
    }
    throw error;
  }
}

/**
 * Probes the ledger window the RPC is willing to serve. Soroban rejects
 * `startLedger: 1` once the window has moved past it and reports the available
 * range in the error, which is the only way to learn the oldest readable
 * ledger.
 */
async function probeLedgerWindow(
  rpcUrl: string,
  filters: unknown[],
  options: StellarRpcOptions,
): Promise<{ oldest: number; latest?: number }> {
  try {
    const page = await getEventsPage(
      rpcUrl,
      filters,
      1,
      { startLedger: 1 },
      options,
      /* retentionLedger */ undefined,
    );
    return { oldest: 1, latest: page.latestLedger };
  } catch (error) {
    if (error instanceof StellarRpcError) {
      const window = parseLedgerWindow(error.message);
      if (window) return { oldest: window.oldest, latest: window.latest };
    }
    throw error;
  }
}

/**
 * Follows `getEvents` pagination until every event through the committed
 * boundary has been read, calling `onPage` after each page.
 */
export async function fetchEventPages(
  options: FetchEventPagesOptions,
): Promise<FetchEventPagesResult> {
  const { rpcUrl, contractId, onPage } = options;
  const rpcOptions: StellarRpcOptions = { timeoutMs: options.timeoutMs, signal: options.signal };
  const filters = options.filters ?? [{ type: 'contract', contractIds: [contractId] }];
  const pageLimit = options.pageLimit ?? DEFAULT_EVENTS_PAGE_LIMIT;
  const lookbackLedgers = options.lookbackLedgers ?? DEFAULT_EVENT_LOOKBACK_LEDGERS;
  const maxPages = options.maxPages ?? MAX_EVENT_PAGES;

  if (!Number.isSafeInteger(pageLimit) || pageLimit <= 0) {
    throw new Error('pageLimit must be a positive integer');
  }

  const window = await probeLedgerWindow(rpcUrl, filters, rpcOptions);
  const latest = window.latest ?? (await fetchLatestLedger(rpcUrl, rpcOptions));
  const oldest = window.oldest;
  const startLedger = options.startLedger ?? Math.max(oldest, latest - lookbackLedgers);
  if (!Number.isSafeInteger(startLedger) || startLedger <= 0) {
    throw new Error('startLedger must be a positive integer');
  }
  if (startLedger < oldest) {
    throw new StellarRetentionExceededError(startLedger, oldest);
  }

  const throughLedger = options.throughLedger ?? latest;
  if (startLedger > throughLedger) {
    return {
      events: [],
      nextLedger: startLedger,
      committedLedger: startLedger - 1,
      throughLedger,
      pages: 0,
      truncated: false,
      malformedEvents: 0,
    };
  }

  const events: StellarRpcEvent[] = [];
  let committedLedger = startLedger - 1;
  let malformedEvents = 0;
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  while (pages < maxPages) {
    const requestedLedger = committedLedger + 1;
    const page = await getEventsPage(
      rpcUrl,
      filters,
      pageLimit,
      cursor ? { cursor } : { startLedger: requestedLedger },
      rpcOptions,
      requestedLedger,
    );
    pages += 1;
    events.push(...page.events);
    malformedEvents += page.malformedEvents;

    const pageMaxLedger = page.events.reduce<number | undefined>(
      (max, event) =>
        event.ledger !== undefined && (max === undefined || event.ledger > max)
          ? event.ledger
          : max,
      undefined,
    );

    // The RPC returns a continuation cursor even on an empty page. At the tip that cursor
    // means "read through ledger N" and is echoed unchanged until the next ledger closes.
    // An empty page whose cursor has reached the latest ledger is therefore the end of
    // the data, not a stalled cursor; every other repeated cursor still throws below.
    const atTip =
      page.cursor !== undefined &&
      page.events.length === 0 &&
      page.latestLedger !== undefined &&
      (cursorLedger(page.cursor) ?? -1) >= page.latestLedger;

    if (page.cursor === undefined || atTip) {
      // The window is exhausted: every ledger the RPC was able to serve has
      // been read, so the scan may commit up to the smaller of the two tips.
      committedLedger = Math.min(throughLedger, page.latestLedger ?? throughLedger);
    } else if (pageMaxLedger !== undefined) {
      // A cursor means more events follow this page, so the page may have
      // stopped partway through its last ledger. Events arrive in ledger order,
      // which makes every ledger below that one fully consumed, while the last
      // one is not: committing it would let a restart skip its remaining
      // events. Commit up to the last proven ledger and re-read the boundary
      // ledger on resume instead.
      committedLedger = Math.max(committedLedger, Math.min(throughLedger, pageMaxLedger - 1));
    }

    await onPage?.({
      page: pages,
      events: page.events,
      malformedEvents: page.malformedEvents,
      committedLedger,
    });

    if (page.cursor === undefined || atTip) break;
    if (committedLedger >= throughLedger) break;
    if (page.cursor === cursor) {
      throw new StellarRpcResponseError('getEvents', 'cursor did not advance between pages');
    }
    cursor = page.cursor;
  }

  if (pages >= maxPages && cursor !== undefined && committedLedger < throughLedger) {
    truncated = true;
  }

  return {
    events,
    nextLedger: committedLedger + 1,
    committedLedger,
    throughLedger,
    pages,
    truncated,
    malformedEvents,
  };
}
