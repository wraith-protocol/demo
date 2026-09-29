import { useState, useCallback, useRef } from 'react';
import { useTransactionIntentStore, TransactionIntent } from '@/stores/transactionIntentStore';
import { useActivityStore } from '@/stores/activityStore';

interface UseIdempotentTransactionParams {
  chain: string;
  wallet: string;
  action: TransactionIntent['action'];
  metadata?: Record<string, any>;
}

/**
 * Two-phase transaction builder.
 *
 * Phase 1 – `build`: sign the transaction locally and return the txHash.
 *   The hook persists the hash into the intent store BEFORE phase 2 runs,
 *   so a network timeout can never leave the intent without a hash.
 *
 * Phase 2 – `submit`: broadcast the signed transaction to the network and
 *   return an arbitrary result.  Throwing here still allows reconciliation
 *   because the hash was already stored in phase 1.
 */
export interface TxBuilderPhases<T> {
  /** Sign locally; return the deterministic txHash. Must not touch the network. */
  build: () => Promise<{ txHash: string; signedTx: unknown }>;
  /** Broadcast the pre-signed tx; return the final result on success. */
  submit: (signedTx: unknown) => Promise<T>;
}

interface UseIdempotentTransactionReturn {
  isSubmitting: boolean;
  intentId: string | null;
  submit: <T>(
    phases: TxBuilderPhases<T>,
    options?: {
      onSuccess?: (result: T) => void;
      onError?: (error: Error) => void;
      reconcile?: (txHash: string) => Promise<boolean | null>;
    },
  ) => Promise<void>;
  reset: () => void;
}

/**
 * Hook to ensure idempotent transaction submission.
 * Prevents double submissions and reconciles pending intents with confirmed transactions.
 *
 * Key guarantee: txHash is persisted into the intent store and activity store
 * AFTER signing but BEFORE the network broadcast, so a timeout/crash after
 * broadcast can always be reconciled on the next page load.
 */
export function useIdempotentTransaction(
  params: UseIdempotentTransactionParams,
): UseIdempotentTransactionReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const submissionLockRef = useRef(false);

  const { createIntent, updateIntentStatus, setIntentTxHash, findPendingIntent } =
    useTransactionIntentStore();

  const { addEntry: addActivity, updateStatus: updateActivity } = useActivityStore();

  const submit = useCallback(
    async <T>(
      phases: TxBuilderPhases<T>,
      options?: {
        onSuccess?: (result: T) => void;
        onError?: (error: Error) => void;
        reconcile?: (txHash: string) => Promise<boolean | null>;
      },
    ) => {
      // Prevent concurrent submissions from the same component instance
      if (submissionLockRef.current) {
        console.warn('[IdempotentTx] Submission already in progress, ignoring duplicate call');
        return;
      }

      // Check for existing pending intent with same parameters
      const existingIntent = findPendingIntent(params);
      if (existingIntent) {
        console.warn(
          '[IdempotentTx] Found existing pending intent, blocking duplicate:',
          existingIntent.id,
        );
        return;
      }

      submissionLockRef.current = true;
      setIsSubmitting(true);

      const newIntentId = createIntent(params);
      setIntentId(newIntentId);

      let txHash: string | undefined;

      try {
        // ── Phase 1: build & sign (no network) ──────────────────────────────
        updateIntentStatus(newIntentId, 'signing');

        const { txHash: builtHash, signedTx } = await phases.build();
        txHash = builtHash;

        // Persist hash BEFORE touching the network so a timeout can always
        // be reconciled.
        setIntentTxHash(newIntentId, txHash);
        addActivity({
          id: txHash,
          chain: params.chain,
          wallet: params.wallet,
          kind: getActivityKind(params.action),
          direction: getActivityDirection(params.action),
          status: 'pending',
          timestamp: Date.now(),
          metadata: { intentId: newIntentId },
        });

        // ── Phase 2: broadcast ───────────────────────────────────────────────
        updateIntentStatus(newIntentId, 'submitting');

        const result = await phases.submit(signedTx);

        updateIntentStatus(newIntentId, 'confirmed');
        updateActivity(txHash, 'confirmed');

        options?.onSuccess?.(result);
      } catch (error) {
        const err = error as Error;
        console.error('[IdempotentTx] Transaction failed:', err);

        // txHash is set whenever phase 1 completed, even if phase 2 timed out.
        if (txHash && options?.reconcile) {
          try {
            console.log('[IdempotentTx] Reconciling:', txHash);
            const reconcileResult = await options.reconcile(txHash);
            if (reconcileResult === true) {
              console.log('[IdempotentTx] Reconciled as confirmed:', txHash);
              updateIntentStatus(newIntentId, 'confirmed');
              updateActivity(txHash, 'confirmed');
              options?.onSuccess?.({} as T);
              return;
            }
            if (reconcileResult === null) {
              // Horizon unavailable — keep intent pending for next poll
              console.warn('[IdempotentTx] Horizon unavailable, keeping intent pending:', txHash);
              updateIntentStatus(newIntentId, 'submitting');
              return;
            }
          } catch (reconcileError) {
            console.error('[IdempotentTx] Reconciliation failed:', reconcileError);
          }
        }

        updateIntentStatus(newIntentId, 'failed', err.message);
        if (txHash) updateActivity(txHash, 'failed');

        if (options?.onError) {
          options.onError(err);
        } else {
          throw error;
        }
      } finally {
        submissionLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      params,
      createIntent,
      updateIntentStatus,
      setIntentTxHash,
      findPendingIntent,
      addActivity,
      updateActivity,
    ],
  );

  const reset = useCallback(() => {
    setIntentId(null);
    setIsSubmitting(false);
    submissionLockRef.current = false;
  }, []);

  return { isSubmitting, intentId, submit, reset };
}

// Helper to map action to ActivityKind
function getActivityKind(action: TransactionIntent['action']) {
  switch (action) {
    case 'send':
      return 'stealth-send' as const;
    case 'batch-send':
      return 'stealth-send' as const;
    case 'batch-withdraw':
    case 'vault-claim':
      return 'withdrawal' as const;
    case 'vault-deposit':
      return 'stealth-send' as const;
    case 'name-register':
    case 'name-transfer':
    case 'name-renew':
    case 'name-set-metadata':
      return 'name-registration' as const;
    default:
      return 'stealth-send' as const;
  }
}

// Helper to map action to ActivityDirection
function getActivityDirection(action: TransactionIntent['action']) {
  switch (action) {
    case 'batch-withdraw':
    case 'vault-claim':
      return 'in' as const;
    default:
      return 'out' as const;
  }
}
