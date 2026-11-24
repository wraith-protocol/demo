import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  discardChainSubmission,
  findUnresolvedChainSubmission,
  listForeignUnresolvedSubmissions,
  reconcileChainSubmission,
  type ChainSubmissionAdapter,
  type ReconcileVerdict,
  type SubmissionRecord,
  type SubmissionScope,
} from '@/lib/submissionIdempotency';

export interface PendingChainSubmissionState {
  /** Unresolved submission for the connected account/network, if any. */
  record: SubmissionRecord | null;
  /** Latest reconciliation verdict for `record`. */
  verdict: ReconcileVerdict | null;
  /** Unresolved submissions on this chain bound to another account/network. */
  foreignCount: number;
  checking: boolean;
  /** True while a new send must stay blocked. */
  blocked: boolean;
  check: () => Promise<void>;
  /** Re-reads persisted state, e.g. after a send attempt finished. */
  refresh: () => void;
  /** Explicit user decision after reviewing the transaction in an explorer. */
  discard: () => Promise<void>;
}

function scopeKey(scope: SubmissionScope | null): string {
  return scope ? `${scope.chain}|${scope.network}|${scope.account.toLowerCase()}` : '';
}

/**
 * Surfaces an unresolved submission after refresh, account or network
 * switches, and reconciles it against the chain. It never prepares, signs
 * or rebuilds a transaction; it only reads status and updates the record.
 */
export function usePendingChainSubmission(
  scope: SubmissionScope | null,
  adapter: ChainSubmissionAdapter | null,
): PendingChainSubmissionState {
  const key = scopeKey(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableScope = useMemo(() => scope, [key]);
  const [record, setRecord] = useState<SubmissionRecord | null>(null);
  const [verdict, setVerdict] = useState<ReconcileVerdict | null>(null);
  const [foreignCount, setForeignCount] = useState(0);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(() => {
    if (!stableScope) {
      setRecord(null);
      setForeignCount(0);
      return;
    }
    try {
      setRecord(findUnresolvedChainSubmission(stableScope));
      setForeignCount(listForeignUnresolvedSubmissions(stableScope).length);
    } catch {
      setRecord(null);
    }
  }, [stableScope]);

  const check = useCallback(async () => {
    if (!stableScope || !adapter) return;
    const current = findUnresolvedChainSubmission(stableScope);
    if (!current) {
      refresh();
      return;
    }
    setChecking(true);
    try {
      const result = await reconcileChainSubmission(current.operationId, stableScope, adapter);
      setVerdict(result.verdict);
    } catch (error) {
      setVerdict({
        state: 'unknown',
        reason: error instanceof Error ? error.message : 'status lookup failed',
      });
    } finally {
      setChecking(false);
      refresh();
    }
  }, [stableScope, adapter, refresh]);

  const discard = useCallback(async () => {
    if (!stableScope || !record) return;
    await discardChainSubmission(record.operationId, stableScope);
    setVerdict(null);
    refresh();
  }, [stableScope, record, refresh]);

  useEffect(() => {
    setVerdict(null);
    refresh();
    void check();
  }, [refresh, check]);

  return {
    record,
    verdict,
    foreignCount,
    checking,
    blocked: record !== null,
    check,
    refresh,
    discard,
  };
}
