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

/** Hard cap on persisted entries; oldest terminal entries are pruned first. */
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
  writeVersioned(storage, OFFLINE_QUEUE_STORAGE_KEY, entries.slice(0, MAX_OFFLINE_QUEUE_ITEMS));
}

/** Entries still awaiting reconciliation, oldest first. */
export function pendingEntries(entries: OfflineQueueEntry[]): OfflineQueueEntry[] {
  return entries.filter((e) => e.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
}

/** Entries waiting on the user (review or conflict resolution). */
export function actionableEntries(entries: OfflineQueueEntry[]): OfflineQueueEntry[] {
  return entries.filter((e) => e.status === 'needs-review' || e.status === 'conflict');
}

/**
 * Adds an entry, enforcing dedupe (by id, and by txHash for signed
 * envelopes) and the collection cap. Returns the new list.
 */
export function addEntry(
  entries: OfflineQueueEntry[],
  entry: OfflineQueueEntry,
): OfflineQueueEntry[] {
  if (entries.some((e) => e.id === entry.id)) return entries;
  if (
    entry.kind === 'signed-submit' &&
    entries.some(
      (e) =>
        e.kind === 'signed-submit' &&
        (e.payload as SignedSubmitPayload).txHash === (entry.payload as SignedSubmitPayload).txHash,
    )
  ) {
    return entries;
  }
  const next = [...entries, entry];
  if (next.length <= MAX_OFFLINE_QUEUE_ITEMS) return next;
  // Prune oldest terminal entries first; never drop actionable work silently
  // while terminal entries remain.
  const terminal = next.filter((e) => isTerminalStatus(e.status));
  const overflow = next.length - MAX_OFFLINE_QUEUE_ITEMS;
  const dropIds = new Set(
    terminal
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, overflow)
      .map((e) => e.id),
  );
  const pruned = next.filter((e) => dropIds.has(e.id) === false);
  return pruned.slice(-MAX_OFFLINE_QUEUE_ITEMS);
}
