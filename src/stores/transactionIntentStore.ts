import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IntentStatus =
  | 'pending'
  | 'signing'
  | 'submitting'
  | 'confirmed'
  | 'failed'
  | 'abandoned';

export interface TransactionIntent {
  id: string; // Unique idempotency key (generated from intent parameters)
  chain: string;
  wallet: string;
  action:
    | 'send'
    | 'batch-send'
    | 'batch-withdraw'
    | 'vault-deposit'
    | 'vault-claim'
    | 'name-register'
    | 'name-transfer'
    | 'name-renew'
    | 'name-set-metadata';
  status: IntentStatus;
  txHash?: string; // Set after transaction is built/signed
  horizonHash?: string; // Actual hash returned by Horizon
  createdAt: number;
  updatedAt: number;
  expiresAt: number; // Intent expires after 5 minutes
  error?: string;
  metadata?: Record<string, any>; // Store intent params for deduplication
}

interface TransactionIntentState {
  intents: TransactionIntent[];
  createIntent: (params: {
    chain: string;
    wallet: string;
    action: TransactionIntent['action'];
    metadata?: Record<string, any>;
  }) => string; // Returns idempotency key
  getIntent: (id: string) => TransactionIntent | undefined;
  updateIntentStatus: (id: string, status: IntentStatus, error?: string) => void;
  setIntentTxHash: (id: string, txHash: string) => void;
  setIntentHorizonHash: (id: string, horizonHash: string) => void;
  findPendingIntent: (params: {
    chain: string;
    wallet: string;
    action: TransactionIntent['action'];
    metadata?: Record<string, any>;
  }) => TransactionIntent | undefined;
  cleanupExpired: () => void;
  abandonIntent: (id: string) => void;
  /**
   * On app reload, reconcile every intent that has a txHash but is still
   * in 'submitting' state (i.e. the tab was closed/crashed after signing but
   * before a definitive Horizon response).  Returns the number of intents
   * whose status was updated.
   */
  reconcilePendingOnMount: (
    reconcileFn: (txHash: string) => Promise<boolean | null>,
    updateActivityStatus: (id: string, status: 'confirmed' | 'failed') => void,
  ) => Promise<number>;
}

// Generate deterministic idempotency key from intent parameters
function generateIdempotencyKey(params: {
  chain: string;
  wallet: string;
  action: string;
  metadata?: Record<string, any>;
}): string {
  const baseString = `${params.chain}:${params.wallet}:${params.action}`;
  if (params.metadata) {
    // Sort keys for deterministic hashing
    const sortedMetadata = Object.keys(params.metadata)
      .sort()
      .map((key) => `${key}=${JSON.stringify(params.metadata![key])}`)
      .join('&');
    return `${baseString}:${sortedMetadata}`;
  }
  return baseString;
}

// Generate unique ID (non-deterministic, for single-intent tracking)
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export const useTransactionIntentStore = create<TransactionIntentState>()(
  persist(
    (set, get) => ({
      intents: [],

      createIntent: (params) => {
        // First, cleanup expired intents
        get().cleanupExpired();

        // Check if there's already a pending/signing/submitting intent with same parameters
        const existingIntent = get().findPendingIntent(params);
        if (existingIntent) {
          // Return existing intent ID to prevent duplicate
          return existingIntent.id;
        }

        // Create new intent with unique ID
        const id = generateUniqueId();
        const now = Date.now();
        const newIntent: TransactionIntent = {
          id,
          chain: params.chain,
          wallet: params.wallet,
          action: params.action,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 5 * 60 * 1000, // 5 minutes
          metadata: params.metadata,
        };

        set((state) => ({
          intents: [newIntent, ...state.intents],
        }));

        return id;
      },

      getIntent: (id) => {
        return get().intents.find((intent) => intent.id === id);
      },

      updateIntentStatus: (id, status, error) => {
        set((state) => ({
          intents: state.intents.map((intent) =>
            intent.id === id ? { ...intent, status, error, updatedAt: Date.now() } : intent,
          ),
        }));
      },

      setIntentTxHash: (id, txHash) => {
        set((state) => ({
          intents: state.intents.map((intent) =>
            intent.id === id ? { ...intent, txHash, updatedAt: Date.now() } : intent,
          ),
        }));
      },

      setIntentHorizonHash: (id, horizonHash) => {
        set((state) => ({
          intents: state.intents.map((intent) =>
            intent.id === id ? { ...intent, horizonHash, updatedAt: Date.now() } : intent,
          ),
        }));
      },

      findPendingIntent: (params) => {
        const idempotencyKey = generateIdempotencyKey(params);

        // Find any intent with same parameters that's still active
        return get().intents.find((intent) => {
          if (
            intent.status === 'confirmed' ||
            intent.status === 'failed' ||
            intent.status === 'abandoned'
          ) {
            return false;
          }

          const intentKey = generateIdempotencyKey({
            chain: intent.chain,
            wallet: intent.wallet,
            action: intent.action,
            metadata: intent.metadata,
          });

          return intentKey === idempotencyKey && Date.now() < intent.expiresAt;
        });
      },

      cleanupExpired: () => {
        const now = Date.now();
        set((state) => ({
          intents: state.intents.filter((intent) => {
            // Keep confirmed, failed, or recent intents (last 24 hours)
            if (
              intent.status === 'confirmed' ||
              intent.status === 'failed' ||
              intent.status === 'abandoned'
            ) {
              return now - intent.updatedAt < 24 * 60 * 60 * 1000;
            }
            // Mark expired pending/signing/submitting as abandoned
            if (now >= intent.expiresAt) {
              intent.status = 'abandoned';
              intent.updatedAt = now;
              return true;
            }
            return true;
          }),
        }));
      },

      abandonIntent: (id) => {
        set((state) => ({
          intents: state.intents.map((intent) =>
            intent.id === id
              ? { ...intent, status: 'abandoned' as IntentStatus, updatedAt: Date.now() }
              : intent,
          ),
        }));
      },

      reconcilePendingOnMount: async (reconcileFn, updateActivityStatus) => {
        // Only reconcile intents that were actively submitting (have a txHash)
        // when the page was last closed.  Pure 'signing' intents with no hash
        // cannot be reconciled and are left for cleanupExpired to abandon.
        const candidates = get().intents.filter(
          (i) => (i.status === 'submitting' || i.status === 'signing') && i.txHash,
        );

        let updated = 0;

        for (const intent of candidates) {
          const txHash = intent.txHash!;
          try {
            const result = await reconcileFn(txHash);

            if (result === true) {
              get().updateIntentStatus(intent.id, 'confirmed');
              updateActivityStatus(txHash, 'confirmed');
              updated++;
            } else if (result === false) {
              // Definitively absent — mark failed so the user can resubmit
              get().updateIntentStatus(intent.id, 'failed', 'Transaction not found on Horizon');
              updateActivityStatus(txHash, 'failed');
              updated++;
            }
            // null means Horizon unavailable — leave as-is so pollPending retries later
          } catch {
            // Ignore per-intent errors; move on to the next
          }
        }

        return updated;
      },
    }),
    {
      name: 'wraith-transaction-intents',
    },
  ),
);
