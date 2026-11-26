import { useLayoutEffect } from 'react';
import { beginTransactionActivity, type TransactionPhase } from '@/lib/transactionActivity';

/** Reflect long-lived wallet/confirmation states in the application update gate. */
export function useTransactionActivity(active: boolean, phase: TransactionPhase = 'submitting') {
  useLayoutEffect(() => {
    if (active) return beginTransactionActivity(phase);
  }, [active, phase]);
}
