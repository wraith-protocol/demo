import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import {
  validateBatchWithdrawal,
  buildBatchWithdrawTx,
  submitBatchWithdrawal,
} from '@/lib/stellar/withdraw';
import type { BatchWithdrawItem, BatchWithdrawResult } from '@/lib/stellar/withdraw';
import { CopyButton } from '@/components/CopyButton';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { useActivityStore } from '@/stores/activityStore';
import { useStellarWallet } from '@/context/StellarWalletContext';

export interface StellarBatchWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMatches: MatchedAnnouncement[];
  knownBalances: Record<string, string>;
  onBatchSuccess: (txHash: string) => void;
}

export function StellarBatchWithdrawModal({
  isOpen,
  onClose,
  selectedMatches,
  knownBalances,
  onBatchSuccess,
}: StellarBatchWithdrawModalProps) {
  const { t } = useTranslation();
  const { address: walletAddress } = useStellarWallet();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);

  const [globalDestination, setGlobalDestination] = useState('');
  const [assetKey] = useState<StellarAssetKey>('XLM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [executionResult, setExecutionResult] = useState<BatchWithdrawResult | null>(null);

  // Convert selected matches into BatchWithdrawItems
  const rawItems: BatchWithdrawItem[] = useMemo(() => {
    return selectedMatches.map((match) => ({
      match,
      balance: knownBalances[match.stealthAddress] || '0',
      assetKey,
    }));
  }, [selectedMatches, knownBalances, assetKey]);

  // Compute validation preview
  const preview = useMemo(() => {
    return validateBatchWithdrawal(rawItems, globalDestination);
  }, [rawItems, globalDestination]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (preview.validItems.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setExecutionResult(null);
    setStatusMessage('Building atomic multi-operation transaction…');

    try {
      // Step 1: Build atomic multi-operation transaction
      const { txXdr, txHash } = await buildBatchWithdrawTx(preview.validItems);

      // Record activity item in pending state
      addActivity({
        id: txHash,
        chain: 'stellar',
        wallet: walletAddress || '',
        kind: 'withdrawal',
        direction: 'out',
        status: 'pending',
        amount: preview.totalAmountXLM,
        recipient: globalDestination,
        timestamp: Date.now(),
      });

      setStatusMessage('Submitting batch to Stellar Horizon network…');

      // Step 2: Submit to network
      const result = await submitBatchWithdrawal(txXdr, preview.validItems);
      setExecutionResult(result);

      if (result.success && result.txHash) {
        updateActivity(result.txHash, 'confirmed');
        onBatchSuccess(result.txHash);
      } else {
        updateActivity(txHash, 'failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch withdrawal failed';
      setExecutionResult({
        success: false,
        error: msg,
        entryResults: preview.validItems.map((item) => ({
          stealthAddress: item.match.stealthAddress,
          success: false,
          error: msg,
        })),
      });
    } finally {
      setIsSubmitting(false);
      setStatusMessage('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col border border-outline-variant bg-surface p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline-variant pb-4">
          <div>
            <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-on-surface">
              Batch Withdrawal Preview
            </h2>
            <p className="font-mono text-xs text-outline">
              Selected {selectedMatches.length} stealth deposit
              {selectedMatches.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-8 w-8 items-center justify-center text-outline hover:text-on-surface disabled:opacity-30"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Global Destination Input */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Global Destination Address (G...)
            </label>
            <input
              type="text"
              value={globalDestination}
              onChange={(e) => setGlobalDestination(e.target.value)}
              placeholder="Enter destination Stellar address G..."
              disabled={isSubmitting}
              className="h-10 border border-outline-variant bg-surface-container px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary disabled:opacity-50"
            />
          </div>

          {/* Fee & Wall-Clock Execution Summary */}
          <div className="grid grid-cols-2 gap-3 border border-outline-variant bg-surface-container p-3 sm:grid-cols-4">
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-outline">
                Total Deposits
              </span>
              <span className="font-heading text-sm font-bold text-on-surface">
                {selectedMatches.length}
              </span>
            </div>

            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-outline">
                Total Amount
              </span>
              <span className="font-heading text-sm font-bold text-tertiary">
                {preview.totalAmountXLM} XLM
              </span>
            </div>

            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-outline">
                Total Network Fee
              </span>
              <span className="font-mono text-xs font-semibold text-on-surface">
                {preview.totalFeeXLM} XLM
              </span>
              <span className="block font-mono text-[9px] text-outline">
                ({preview.totalFeeStroops} stroops)
              </span>
            </div>

            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-outline">
                Expected Time
              </span>
              <span className="font-mono text-xs font-semibold text-on-surface">
                ~{preview.expectedWallClockSeconds}s
              </span>
              <span className="block font-mono text-[9px] text-tertiary">
                {preview.isAtomic ? 'Atomic (All-or-Nothing)' : 'Batch'}
              </span>
            </div>
          </div>

          {/* Submission Status Indicator */}
          {statusMessage && (
            <div className="flex items-center gap-2 border border-tertiary/30 bg-tertiary/10 p-3">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-tertiary"></span>
              <span className="font-mono text-xs text-on-surface">{statusMessage}</span>
            </div>
          )}

          {/* Top-Level Execution Result Banner */}
          {executionResult && (
            <div
              className={`p-4 border ${
                executionResult.success
                  ? 'border-tertiary/40 bg-tertiary/10'
                  : 'border-error/40 bg-error/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-heading text-xs uppercase tracking-wider font-bold">
                  {executionResult.success ? 'Batch Withdrawal Complete' : 'Batch Execution Failed'}
                </span>
                {executionResult.txHash && (
                  <a
                    href={stellarTxUrl(executionResult.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-primary underline"
                  >
                    TX: {executionResult.txHash.slice(0, 14)}...
                  </a>
                )}
              </div>
              {executionResult.error && (
                <p className="mt-1 font-mono text-xs text-error">{executionResult.error}</p>
              )}
            </div>
          )}

          {/* Per-Item Breakdown & Entry Failure Causes */}
          <div className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Selected Items & Entry Status
            </h3>

            <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
              {/* Valid Items */}
              {preview.validItems.map((item, idx) => {
                const entryRes = executionResult?.entryResults?.find(
                  (r) => r.stealthAddress === item.match.stealthAddress,
                );

                return (
                  <div
                    key={item.match.stealthAddress}
                    className="flex items-center justify-between border border-outline-variant/60 bg-surface-container/50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="font-mono text-[9px] text-outline">#{idx + 1} Stealth</span>
                      <a
                        href={stellarAddrUrl(item.match.stealthAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-mono text-xs text-primary hover:underline"
                      >
                        {item.match.stealthAddress}
                      </a>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-semibold text-on-surface">
                        {item.sendableAmount} XLM
                      </span>

                      {entryRes ? (
                        entryRes.success ? (
                          <span className="bg-tertiary/20 px-2 py-0.5 font-mono text-[9px] uppercase text-tertiary">
                            Success
                          </span>
                        ) : (
                          <span className="bg-error/20 px-2 py-0.5 font-mono text-[9px] uppercase text-error">
                            {entryRes.error || 'Failed'}
                          </span>
                        )
                      ) : (
                        <span className="bg-surface-bright px-2 py-0.5 font-mono text-[9px] text-tertiary">
                          Ready
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Invalid Items */}
              {preview.invalidItems.map(({ item, reason }, idx) => (
                <div
                  key={item.match.stealthAddress}
                  className="flex items-center justify-between border border-error/30 bg-error/5 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="font-mono text-[9px] text-error">
                      Invalid Entry #{idx + 1}
                    </span>
                    <span className="block truncate font-mono text-xs text-on-surface">
                      {item.match.stealthAddress}
                    </span>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="font-mono text-[10px] text-error">{reason}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-outline-variant pt-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="h-10 border border-outline-variant px-4 font-heading text-[10px] uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-surface-bright disabled:opacity-30"
          >
            {executionResult?.success ? 'Close' : 'Cancel'}
          </button>

          {!executionResult?.success && (
            <button
              onClick={handleConfirm}
              disabled={!globalDestination || preview.validItems.length === 0 || isSubmitting}
              className="h-10 bg-primary px-5 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isSubmitting ? 'Processing...' : `Confirm & Withdraw (${preview.validItems.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
