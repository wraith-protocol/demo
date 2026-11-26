import { transactionStorageError } from './appCompatibility';

export type TransactionPhase = 'simulating' | 'signing' | 'submitting' | 'reconciling';
const activities = new Map<symbol, TransactionPhase>();
const listeners = new Set<() => void>();
let compatibilityError: string | null = null;
let preparingUpdate = false;

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeTransactionActivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function transactionBlockReason(): string | null {
  return (
    compatibilityError ??
    transactionStorageError() ??
    (preparingUpdate ? 'An application update is in progress. Wait for the reload.' : null)
  );
}

export function assertTransactionCompatible() {
  const error = transactionBlockReason();
  if (error) throw new Error(error);
}

export function setCompatibilityError(error: string | null) {
  compatibilityError = error;
  emit();
}

export function beginTransactionActivity(phase: TransactionPhase): () => void {
  const id = Symbol(phase);
  activities.set(id, phase);
  emit();
  return () => {
    activities.delete(id);
    emit();
  };
}

export function activeTransactionReason(): string | null {
  return activities.size
    ? 'Finish the active transaction before reloading (simulation, wallet approval, submission or reconciliation).'
    : null;
}

/** Synchronous gate closes the race between voting for activation and starting work. */
export function prepareForUpdate(): boolean {
  if (activeTransactionReason() || transactionStorageError()) return false;
  preparingUpdate = true;
  emit();
  return true;
}

export function cancelPreparedUpdate() {
  preparingUpdate = false;
  emit();
}

export async function withTransactionActivity<T>(
  phase: TransactionPhase,
  action: () => Promise<T>,
): Promise<T> {
  assertTransactionCompatible();
  const finish = beginTransactionActivity(phase);
  try {
    return await action();
  } finally {
    finish();
  }
}
