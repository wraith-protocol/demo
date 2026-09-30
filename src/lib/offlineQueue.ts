import {
  isBoundedString,
  isFiniteTimestamp,
  readVersionedCollection,
  writeVersioned,
} from './versionedStorage';

/**
 * Explicit offline queue (Wave 9, issue #184).
 *
 * The PWA shell caches assets, but transaction and scanner work previously
 * had no documented offline policy: a user who lost connectivity mid-flow
 * was left with stale pending state after reconnecting.
 *
 * This module is the framework-free core of that policy:
 *
 * - Every unit of offline work has a **kind** (`OfflineWorkKind`).
 * - Each kind maps to a **policy** (`OfflineQueuePolicy`) via
 *   {@link classifyOfflineWork}:
 *   - `safe-to-queue` — data-only work that can be persisted and completed
 *     later without new secrets: scanned QR / payment-link payloads
 *     (`scan-session`) and unsigned user intents (`payment-intent`).
 *   - `signing-required` — work that must never be completed silently:
 *     fully-signed transaction envelopes (`signed-submit`) are held for
 *     explicit user review and one-tap broadcast after reconnect. Nothing
 *     here ever triggers a wallet signature on its own.
 * - Entries persist in localStorage (validated + bounded, see
 *   `versionedStorage`) so they survive reloads, and
 *   `offlineReconcile.ts` resolves them on reconnect with explicit
 *   `done` / `needs-review` / `conflict` / `failed` outcomes.
 */

export const OFFLINE_QUEUE_STORAGE_KEY = 'wraith-offline-queue';

/**
 * Hard cap on queue entries.
 *
 * Cap policy (no silent drops of actionable work):
 * - `addEntry` evicts oldest *terminal* entries to make room, and
 *   explicitly rejects (`accepted: false`, input untouched) when the queue
 *   is full of actionable work — the caller must tell the user.
 * - `enforceQueueCap` applies the same rule to oversized loaded state.
 * - `saveOfflineQueue` persists exactly what it is given; every producer
 *   above enforces the cap, so the save path never truncates.
 */
export const MAX_OFFLINE_QUEUE_ITEMS = 50;

/** Signed envelopes older than this are treated as stale on reconcile. */
export const SIGNED_ENVELOPE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum reconcile attempts before an entry is marked `failed`. */
export const MAX_RECONCILE_ATTEMPTS = 5;

export type OfflineWorkKind = 'payment-intent' | 'scan-session' | 'signed-submit';

export type OfflineQueuePolicy = 'safe-to-queue' | 'signing-required';

export type OfflineEntryStatus =
  | 'queued'
  | 'syncing'
  | 'needs-review'
  | 'done'
  | 'conflict'
  | 'failed';

export const OFFLINE_WORK_KINDS: OfflineWorkKind[] = [
  'payment-intent',
  'scan-session',
  'signed-submit',
];

const OFFLINE_ENTRY_STATUSES: OfflineEntryStatus[] = [
  'queued',
  'syncing',
  'needs-review',
  'done',
  'conflict',
  'failed',
];

/** Terminal states — reconciliation never touches these. */
const TERMINAL_STATUSES: OfflineEntryStatus[] = ['done', 'conflict', 'failed'];

/** Unsigned intent to send; signing happens explicitly after reconnect. */
export interface PaymentIntentPayload {
  chain: string;
  recipient: string;
  amount: string;
  asset?: string;
  memo?: string;
  /** Epoch ms after which the intent (e.g. a payment link) expires. */
  expiresAt?: number | null;
  source: 'form' | 'payment-link' | 'scan';
}

/** A QR / payment-link / shared-text scan captured while offline. */
export interface ScanSessionPayload {
  source: 'camera' | 'image' | 'payment-link' | 'shared-text';
  /** Original scanned text (or page URL for link/share captures). */
  rawText: string;
  parsed?: {
    metaAddress: string;
    amount?: string;
    memo?: string;
  };
  capturedAt: number;
}

/**
 * A fully-signed transaction envelope awaiting broadcast.
 * `signing-required`: reconcile surfaces it for explicit user review and
 * never broadcasts or re-signs on its own.
 */
export interface SignedSubmitPayload {
  chain: string;
  /** Hex transaction hash (also used for dedupe). */
  txHash: string;
  /** Base64- or hex-encoded signed envelope. */
  signedXdr: string;
}

export type OfflineEntryPayload = PaymentIntentPayload | ScanSessionPayload | SignedSubmitPayload;

export interface OfflineQueueEntry {
  id: string;
  kind: OfflineWorkKind;
  policy: OfflineQueuePolicy;
  status: OfflineEntryStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  maxAttempts: number;
  payload: OfflineEntryPayload;
  lastError?: string;
  conflictReason?: string;
}

/** Conflict reasons surfaced to the user with a resolution action. */
export type OfflineConflictReason =
  | 'expired'
  | 'invalid-recipient'
  | 'unparseable-scan'
  | 'stale-envelope'
  | 'unsupported-chain';

/**
 * Maps work to its offline policy. The security boundary of the queue:
 * only `signed-submit` is `signing-required`, and the reconciler is
 * forbidden from completing those entries without explicit user action.
 */
export function classifyOfflineWork(kind: OfflineWorkKind): OfflineQueuePolicy {
  return kind === 'signed-submit' ? 'signing-required' : 'safe-to-queue';
}

/** True for work the queue may complete (or advance) without user action. */
export function isSafeToQueue(kind: OfflineWorkKind): boolean {
  return classifyOfflineWork(kind) === 'safe-to-queue';
}

/** True for work that must stop at `needs-review` / `conflict`, never `done`. */
export function requiresExplicitReview(kind: OfflineWorkKind): boolean {
  return classifyOfflineWork(kind) === 'signing-required';
}

export function isTerminalStatus(status: OfflineEntryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function createId(): string {
  try {
    const cryptoRef = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoRef && 'randomUUID' in cryptoRef) {
      return (cryptoRef as Crypto).randomUUID();
    }
  } catch {
    // Fall through to the Math.random fallback below.
  }
  return `oq-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function createOfflineEntry(
  kind: OfflineWorkKind,
  payload: OfflineEntryPayload,
  now: number = Date.now(),
): OfflineQueueEntry {
  return {
    id: createId(),
    kind,
    policy: classifyOfflineWork(kind),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    maxAttempts: MAX_RECONCILE_ATTEMPTS,
    payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidPayload(kind: OfflineWorkKind, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (kind === 'payment-intent') {
    const p = payload as Record<string, unknown>;
    return (
      isBoundedString(p['chain'], 32) &&
      isBoundedString(p['recipient'], 512) &&
      isBoundedString(p['amount'], 64) &&
      (p['asset'] === undefined || isBoundedString(p['asset'], 32)) &&
      (p['memo'] === undefined || isBoundedString(p['memo'], 512)) &&
      (p['expiresAt'] === undefined ||
        p['expiresAt'] === null ||
        isFiniteTimestamp(p['expiresAt'])) &&
      (p['source'] === 'form' || p['source'] === 'payment-link' || p['source'] === 'scan')
    );
  }
  if (kind === 'scan-session') {
    const p = payload as Record<string, unknown>;
    if (
      !isBoundedString(p['rawText'], 4096) ||
      !isFiniteTimestamp(p['capturedAt']) ||
      (p['source'] !== 'camera' &&
        p['source'] !== 'image' &&
        p['source'] !== 'payment-link' &&
        p['source'] !== 'shared-text')
    ) {
      return false;
    }
    if (p['parsed'] !== undefined) {
      if (!isRecord(p['parsed'])) return false;
      const parsed = p['parsed'] as Record<string, unknown>;
      if (!isBoundedString(parsed['metaAddress'], 512)) return false;
      if (parsed['amount'] !== undefined && !isBoundedString(parsed['amount'], 64)) return false;
      if (parsed['memo'] !== undefined && !isBoundedString(parsed['memo'], 512)) return false;
    }
    return true;
  }
  // signed-submit
  const p = payload as Record<string, unknown>;
  return (
    isBoundedString(p['chain'], 32) &&
    isBoundedString(p['txHash'], 128) &&
    isBoundedString(p['signedXdr'], 20000)
  );
}

/** Validator for `versionedStorage`: drops anything malformed or hostile. */
export function isOfflineEntry(value: unknown): value is OfflineQueueEntry {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  if (kind !== 'payment-intent' && kind !== 'scan-session' && kind !== 'signed-submit') {
    return false;
  }
  const status = value['status'];
  if (!OFFLINE_ENTRY_STATUSES.includes(status as OfflineEntryStatus)) return false;
  if (!isBoundedString(value['id'], 128)) return false;
  if (!isFiniteTimestamp(value['createdAt']) || !isFiniteTimestamp(value['updatedAt'])) {
    return false;
  }
  if (
    typeof value['attempts'] !== 'number' ||
    !Number.isInteger(value['attempts']) ||
    value['attempts'] < 0 ||
    typeof value['maxAttempts'] !== 'number' ||
    !Number.isInteger(value['maxAttempts']) ||
    (value['maxAttempts'] as number) <= 0
  ) {
    return false;
  }
  if (value['lastError'] !== undefined && !isBoundedString(value['lastError'], 1024)) return false;
  if (value['conflictReason'] !== undefined && !isBoundedString(value['conflictReason'], 128)) {
    return false;
  }
  // Policy must agree with kind — a tampered policy that would auto-complete
  // signing-required work is rejected.
  if (value['policy'] !== classifyOfflineWork(kind as OfflineWorkKind)) return false;
  return isValidPayload(kind as OfflineWorkKind, value['payload']);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadOfflineQueue(storage: StorageLike): OfflineQueueEntry[] {
  return readVersionedCollection(storage, OFFLINE_QUEUE_STORAGE_KEY, isOfflineEntry);
}

export function saveOfflineQueue(storage: StorageLike, entries: OfflineQueueEntry[]): void {
  // Intentionally no truncation here: `addEntry` / `enforceQueueCap` own the
  // cap, and silently dropping the tail (usually the newest entry) is exactly
  // the data-loss bug this policy exists to prevent.
  writeVersioned(storage, OFFLINE_QUEUE_STORAGE_KEY, entries);
}

/** Entries still awaiting reconciliation, oldest first. */
export function pendingEntries(entries: OfflineQueueEntry[]): OfflineQueueEntry[] {
  return entries.filter((e) => e.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
}

/** Entries waiting on the user (review or conflict resolution). */
export function actionableEntries(entries: OfflineQueueEntry[]): OfflineQueueEntry[] {
  return entries.filter((e) => e.status === 'needs-review' || e.status === 'conflict');
}

export interface AddEntryResult {
  entries: OfflineQueueEntry[];
  /**
   * False when the queue is full of actionable work: nothing was added,
   * nothing was dropped — `entries` is the untouched input. The caller must
   * surface this (e.g. "queue full, reconnect or discard items").
   */
  accepted: boolean;
  /** Terminal entries evicted to make room (0 when nothing was pruned). */
  evicted: number;
}

/** Oldest terminal entries first — the only entries ever pruned silently. */
function oldestTerminalIds(entries: OfflineQueueEntry[], count: number): Set<string> {
  return new Set(
    entries
      .filter((e) => isTerminalStatus(e.status))
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, count)
      .map((e) => e.id),
  );
}

/**
 * Adds an entry, enforcing dedupe (by id, and by txHash for signed
 * envelopes) and the collection cap.
 *
 * Full-but-actionable queues reject explicitly instead of dropping work:
 * with 50 actionable entries, the 51st returns `{ accepted: false }` and the
 * input list untouched — never 51 items, never a silent tail-drop at save.
 */
export function addEntry(entries: OfflineQueueEntry[], entry: OfflineQueueEntry): AddEntryResult {
  if (entries.some((e) => e.id === entry.id)) return { entries, accepted: true, evicted: 0 };
  if (
    entry.kind === 'signed-submit' &&
    entries.some(
      (e) =>
        e.kind === 'signed-submit' &&
        (e.payload as SignedSubmitPayload).txHash === (entry.payload as SignedSubmitPayload).txHash,
    )
  ) {
    return { entries, accepted: true, evicted: 0 };
  }
  const next = [...entries, entry];
  const overflow = next.length - MAX_OFFLINE_QUEUE_ITEMS;
  if (overflow <= 0) return { entries: next, accepted: true, evicted: 0 };
  const dropIds = oldestTerminalIds(next, overflow);
  const pruned = next.filter((e) => !dropIds.has(e.id));
  if (pruned.length <= MAX_OFFLINE_QUEUE_ITEMS) {
    return { entries: pruned, accepted: true, evicted: dropIds.size };
  }
  // No room even after pruning every terminal entry: the queue is full of
  // actionable work. Reject without mutating anything.
  return { entries, accepted: false, evicted: 0 };
}

export interface EnforceCapResult {
  entries: OfflineQueueEntry[];
  droppedTerminal: number;
  /** Only nonzero for corrupt oversized state with no terminals to prune. */
  droppedNewest: number;
}

/**
 * Caps loaded (possibly corrupt/legacy oversized) state using the same rule:
 * oldest terminal first; if actionable entries alone still exceed the cap,
 * keep the oldest (mirrors `readVersionedCollection`) and report the drop.
 */
export function enforceQueueCap(entries: OfflineQueueEntry[]): EnforceCapResult {
  const overflow = entries.length - MAX_OFFLINE_QUEUE_ITEMS;
  if (overflow <= 0) return { entries, droppedTerminal: 0, droppedNewest: 0 };
  const dropIds = oldestTerminalIds(entries, overflow);
  const pruned = entries.filter((e) => !dropIds.has(e.id));
  if (pruned.length <= MAX_OFFLINE_QUEUE_ITEMS) {
    return { entries: pruned, droppedTerminal: dropIds.size, droppedNewest: 0 };
  }
  return {
    entries: pruned.slice(0, MAX_OFFLINE_QUEUE_ITEMS),
    droppedTerminal: dropIds.size,
    droppedNewest: pruned.length - MAX_OFFLINE_QUEUE_ITEMS,
  };
}
