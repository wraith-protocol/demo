import { create } from 'zustand';
import {
  addEntry,
  createOfflineEntry,
  enforceQueueCap,
  isOfflineEntry,
  loadOfflineQueue,
  saveOfflineQueue,
  type OfflineEntryPayload,
  type OfflineQueueEntry,
  type OfflineWorkKind,
  type PaymentIntentPayload,
  type ScanSessionPayload,
  type SignedSubmitPayload,
} from '@/lib/offlineQueue';
import { defaultReconcileHandlers, reconcileOfflineQueue } from '@/lib/offlineReconcile';
import { STELLAR_NETWORK } from '@/config';
import { useActivityStore } from './activityStore';

export type ReconcilePhase = 'idle' | 'reconciling';

interface OfflineQueueState {
  entries: OfflineQueueEntry[];
  /** Transient; never persisted. */
  phase: ReconcilePhase;
  lastReconciledAt: number | null;
  /** Payload of the most recently reconciled scan (for UI follow-ups). */
  lastAppliedScan: { metaAddress: string; amount?: string; memo?: string } | null;

  /**
   * Returns the entry, or null when the queue is full of actionable work.
   * Callers must handle null explicitly (tell the user — never drop it).
   */
  enqueue: (kind: OfflineWorkKind, payload: OfflineEntryPayload) => OfflineQueueEntry | null;
  enqueuePaymentIntent: (payload: PaymentIntentPayload) => OfflineQueueEntry | null;
  enqueueScanSession: (payload: ScanSessionPayload) => OfflineQueueEntry | null;
  enqueueSignedSubmit: (payload: SignedSubmitPayload) => OfflineQueueEntry | null;
  remove: (id: string) => void;
  clearResolved: () => void;
  /** Runs reconnect reconciliation; safe to call any time (no-op offline). */
  reconcile: () => Promise<void>;
  /**
   * Explicit user-confirmed broadcast of a held signed envelope.
   * This is the ONLY path that submits queued signing-required work.
   */
  broadcastSigned: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function storageOrNull(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readStoredEntries(): OfflineQueueEntry[] {
  const storage = storageOrNull();
  if (!storage) return [];
  try {
    const entries = loadOfflineQueue(storage);
    // Belt-and-braces: the loader already validates, but never let a bad
    // entry shape reach the store. Cap oversized (corrupt/legacy) state with
    // the same prune-oldest-terminal-first rule as live adds.
    return enforceQueueCap(entries.filter(isOfflineEntry)).entries;
  } catch {
    return [];
  }
}

function persistEntries(entries: OfflineQueueEntry[]): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    saveOfflineQueue(storage, entries);
  } catch {
    // A full or disabled localStorage must not break queue updates.
  }
}

function requestQueueSync(): void {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then((registration) => {
        const syncManager = (
          registration as ServiceWorkerRegistration & {
            sync?: { register: (tag: string) => Promise<void> };
          }
        ).sync;
        void syncManager?.register('wraith-offline-queue')?.catch(() => undefined);
      });
    }
  } catch {
    // Background Sync is best-effort; the `online` event is the real trigger.
  }
}

export const useOfflineQueueStore = create<OfflineQueueState>()((set, get) => ({
  entries: readStoredEntries(),
  phase: 'idle',
  lastReconciledAt: null,
  lastAppliedScan: null,

  enqueue: (kind, payload) => {
    const entry = createOfflineEntry(kind, payload);
    const result = addEntry(get().entries, entry);
    if (!result.accepted) return null;
    persistEntries(result.entries);
    set({ entries: result.entries });
    requestQueueSync();
    return entry;
  },

  enqueuePaymentIntent: (payload) => get().enqueue('payment-intent', payload),
  enqueueScanSession: (payload) => get().enqueue('scan-session', payload),
  enqueueSignedSubmit: (payload) => get().enqueue('signed-submit', payload),

  remove: (id) =>
    set((state) => {
      const entries = state.entries.filter((e) => e.id !== id);
      persistEntries(entries);
      return { entries };
    }),

  clearResolved: () =>
    set((state) => {
      const entries = state.entries.filter(
        (e) => e.status === 'queued' || e.status === 'syncing' || e.status === 'needs-review',
      );
      persistEntries(entries);
      return { entries };
    }),

  reconcile: async () => {
    if (get().phase === 'reconciling') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    set({ phase: 'reconciling' });
    try {
      const entries = get().entries;
      const next = await reconcileOfflineQueue(entries, {
        now: Date.now(),
        isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        handlers: {
          ...defaultReconcileHandlers,
          onScanReady: (_entry, payload) => {
            set({ lastAppliedScan: payload });
          },
        },
      });
      persistEntries(next);
      set({ entries: next, lastReconciledAt: Date.now() });
    } finally {
      set({ phase: 'idle' });
    }
  },

  broadcastSigned: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry || entry.kind !== 'signed-submit') {
      return { ok: false, error: 'Queued transaction not found.' };
    }
    const payload = entry.payload as SignedSubmitPayload;
    if (payload.chain !== 'stellar') {
      const failed = get().entries.map((e) =>
        e.id === id
          ? {
              ...e,
              status: 'failed' as const,
              updatedAt: Date.now(),
              lastError: `unsupported-chain: ${payload.chain}`,
            }
          : e,
      );
      persistEntries(failed);
      set({ entries: failed });
      return { ok: false, error: `Chain ${payload.chain} is not supported yet.` };
    }
    try {
      const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(payload.signedXdr)}`,
      });
      const data = (await res.json()) as {
        hash?: string;
        title?: string;
        extras?: { result_codes?: { transaction?: string } };
      };
      if (!res.ok) {
        throw new Error(
          data.extras?.result_codes?.transaction || data.title || 'Broadcast failed.',
        );
      }
      const done = get().entries.map((e) =>
        e.id === id ? { ...e, status: 'done' as const, updatedAt: Date.now() } : e,
      );
      persistEntries(done);
      set({ entries: done });
      try {
        useActivityStore.getState().updateStatus(payload.txHash, 'confirmed');
      } catch {
        // Activity history is best-effort here.
      }
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Broadcast failed.';
      const conflicted = get().entries.map((e) =>
        e.id === id
          ? {
              ...e,
              status: 'conflict' as const,
              updatedAt: Date.now(),
              attempts: e.attempts + 1,
              conflictReason: 'broadcast-rejected',
              lastError: reason.slice(0, 512),
            }
          : e,
      );
      persistEntries(conflicted);
      set({ entries: conflicted });
      return { ok: false, error: reason };
    }
  },
}));
