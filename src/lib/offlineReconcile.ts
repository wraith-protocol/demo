import {
  SIGNED_ENVELOPE_TTL_MS,
  isTerminalStatus,
  requiresExplicitReview,
  type OfflineConflictReason,
  type OfflineQueueEntry,
  type PaymentIntentPayload,
  type ScanSessionPayload,
} from './offlineQueue';
import { parseStellarQrPayload } from '@/utils/qr';

/**
 * Reconnect reconciliation (Wave 9, issue #184).
 *
 * Pure, injectable engine: all I/O comes through `ReconcileHandlers` so the
 * policy can be unit-tested without a network and the app can supply the
 * real validators. Key invariants:
 *
 * - Only `queued` entries are processed; terminal states are never touched.
 * - `safe-to-queue` work (`payment-intent`, `scan-session`) is revalidated
 *   against fresh state and advances to `done` / `needs-review`.
 * - `signing-required` work (`signed-submit`) NEVER auto-broadcasts or
 *   re-signs. Fresh envelopes stop at `needs-review` for explicit user
 *   broadcast; envelopes older than `SIGNED_ENVELOPE_TTL_MS` become
 *   `conflict` (`stale-envelope`) because the sequence number has likely
 *   moved on and re-signing must be a deliberate user action.
 * - Anything that fails validation becomes `conflict` with a machine-readable
 *   `conflictReason` the UI maps to a resolution action — never a silent
 *   drop, never stale `pending` forever.
 */

export type IntentCheck = { ok: true } | { ok: false; reason: OfflineConflictReason };

export type ScanCheck =
  | { ok: true; payload: { metaAddress: string; amount?: string; memo?: string } }
  | { ok: false; reason: OfflineConflictReason };

export interface ReconcileHandlers {
  checkPaymentIntent: (payload: PaymentIntentPayload, now: number) => Promise<IntentCheck>;
  checkScanSession: (payload: ScanSessionPayload, now: number) => Promise<ScanCheck>;
  /** Called with validated scan payloads so the app can apply them. */
  onScanReady?: (
    entry: OfflineQueueEntry,
    payload: { metaAddress: string; amount?: string; memo?: string },
  ) => void | Promise<void>;
}

export interface ReconcileContext {
  now: number;
  isOnline: () => boolean;
  handlers: ReconcileHandlers;
}

function touch(entry: OfflineQueueEntry, now: number): OfflineQueueEntry {
  return { ...entry, updatedAt: now, attempts: entry.attempts + 1 };
}

/**
 * Local (network-free) payment-intent validator used by the app: re-checks
 * expiry and recipient shape. Deterministic, so reconnect behavior in the
 * field matches the Playwright coverage.
 */
export async function validatePaymentIntentLocal(
  payload: PaymentIntentPayload,
  now: number,
): Promise<IntentCheck> {
  if (payload.expiresAt != null && Number.isFinite(payload.expiresAt) && payload.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }
  try {
    parseStellarQrPayload(payload.recipient);
  } catch {
    return { ok: false, reason: 'invalid-recipient' };
  }
  if (!payload.amount || !/^(?:\d+|\d*\.\d+)$/.test(payload.amount)) {
    return { ok: false, reason: 'invalid-recipient' };
  }
  return { ok: true };
}

function extractExpParam(rawText: string): number | null {
  try {
    const url = new URL(rawText);
    const exp = url.searchParams.get('exp');
    if (!exp) return null;
    const secs = Number.parseInt(exp, 10);
    return Number.isFinite(secs) ? secs * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Local (network-free) scan validator: re-parses the captured text and
 * rejects captures whose embedded payment-link expiry has passed.
 */
export async function validateScanSessionLocal(
  payload: ScanSessionPayload,
  now: number,
): Promise<ScanCheck> {
  const expMs = extractExpParam(payload.rawText);
  if (expMs !== null && expMs <= now) {
    return { ok: false, reason: 'expired' };
  }
  try {
    const parsed = parseStellarQrPayload(payload.rawText);
    return {
      ok: true,
      payload: {
        metaAddress: parsed.metaAddress,
        ...(parsed.amount ? { amount: parsed.amount } : {}),
        ...(parsed.memo ? { memo: parsed.memo } : {}),
      },
    };
  } catch {
    return { ok: false, reason: 'unparseable-scan' };
  }
}

export const defaultReconcileHandlers: ReconcileHandlers = {
  checkPaymentIntent: (payload, now) => validatePaymentIntentLocal(payload, now),
  checkScanSession: (payload, now) => validateScanSessionLocal(payload, now),
};

async function reconcileOne(
  entry: OfflineQueueEntry,
  ctx: ReconcileContext,
): Promise<OfflineQueueEntry> {
  const { now, handlers } = ctx;

  if (entry.status !== 'queued' || isTerminalStatus(entry.status)) return entry;

  const next = touch(entry, now);
  if (next.attempts > next.maxAttempts && next.maxAttempts > 0) {
    return { ...next, status: 'failed', lastError: 'max-attempts-exceeded' };
  }

  if (entry.kind === 'payment-intent') {
    const check = await handlers.checkPaymentIntent(entry.payload as PaymentIntentPayload, now);
    if (!check.ok) {
      return { ...next, status: 'conflict', conflictReason: check.reason };
    }
    // Validated intents still need the user: signing stays explicit.
    return { ...next, status: 'needs-review' };
  }

  if (entry.kind === 'scan-session') {
    const check = await handlers.checkScanSession(entry.payload as ScanSessionPayload, now);
    if (!check.ok) {
      return { ...next, status: 'conflict', conflictReason: check.reason };
    }
    try {
      await handlers.onScanReady?.(entry, check.payload);
    } catch (error) {
      return {
        ...next,
        status: 'conflict',
        lastError: error instanceof Error ? error.message : 'scan-apply-failed',
      };
    }
    return { ...next, status: 'done' };
  }

  // signed-submit — signing-required: never broadcast or re-sign here.
  if (requiresExplicitReview(entry.kind)) {
    if (now - entry.createdAt > SIGNED_ENVELOPE_TTL_MS) {
      return { ...next, status: 'conflict', conflictReason: 'stale-envelope' };
    }
    return { ...next, status: 'needs-review' };
  }

  return { ...next, status: 'failed', lastError: 'unsupported-kind' };
}

/**
 * Reconciles every `queued` entry, oldest first. No-op while offline so a
 * flapping connection can't half-advance the queue.
 */
export async function reconcileOfflineQueue(
  entries: OfflineQueueEntry[],
  ctx: ReconcileContext,
): Promise<OfflineQueueEntry[]> {
  if (!ctx.isOnline()) return entries;
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const byId = new Map<string, OfflineQueueEntry>();
  for (const entry of ordered) {
    byId.set(entry.id, await reconcileOne(entry, ctx));
  }
  // Preserve the caller's original ordering.
  return entries.map((entry) => byId.get(entry.id) ?? entry);
}
