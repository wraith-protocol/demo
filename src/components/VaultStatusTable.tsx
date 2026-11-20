import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { StellarLink } from '@/components/StellarLink';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useVaultDeposits } from '@/hooks/useVaultDeposits';
import {
  deriveVaultClaimSigner,
  getVaultActions,
  submitVaultAction,
  type OnChainVaultDeposit,
  type VaultDepositState,
} from '@/lib/stellar/vaultStatus';

function formatCountdown(targetLedger: number, currentLedger: number): string {
  const ledgers = targetLedger - currentLedger;
  if (ledgers <= 0) return 'Reached';
  const minutes = Math.ceil((ledgers * 5) / 60);
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

const stateLabels: Record<VaultDepositState, string> = {
  pending: 'Pending',
  claimable: 'Claimable',
  expired: 'Expired',
  claimed: 'Claimed',
  refunded: 'Refunded',
  failed: 'Failed',
};

const stateColors: Record<VaultDepositState, string> = {
  pending: 'bg-primary',
  claimable: 'bg-tertiary',
  expired: 'bg-error',
  claimed: 'bg-tertiary',
  refunded: 'bg-outline',
  failed: 'bg-error',
};

export function VaultStatusTable() {
  const { address, signTransaction, freighterNetwork, isNetworkMismatch } = useStellarWallet();
  const { stellarKeys } = useStealthKeys();
  const { deposits, currentLedger, loading, error, refresh } = useVaultDeposits(
    address,
    freighterNetwork,
    stellarKeys,
  );
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!address) {
    return (
      <div className="py-12 text-center">
        <p className="font-heading text-sm uppercase tracking-widest text-outline">
          Connect Wallet
        </p>
        <p className="mt-2 font-body text-xs text-on-surface-variant">
          Connect your Freighter wallet to view vault deposit status.
        </p>
      </div>
    );
  }

  const runAction = async (action: 'claim' | 'refund', deposit: OnChainVaultDeposit) => {
    if (isNetworkMismatch) {
      setActionError('Switch Freighter to Stellar Testnet before continuing');
      return;
    }
    setActionId(deposit.id);
    setActionError('');
    try {
      const claimSigner = action === 'claim' ? deriveVaultClaimSigner(deposit, stellarKeys) : null;
      if (action === 'claim' && !claimSigner) {
        throw new Error('This vault deposit does not match the derived stealth key');
      }
      const hash = await submitVaultAction({
        action,
        depositId: deposit.id,
        actor: address,
        signTransaction,
        ...(claimSigner ? { claimSigner } : {}),
      });
      setTxHash(hash);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Vault ${action} failed`);
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {(error || actionError) && <p className="text-sm text-error">{actionError || error}</p>}
      {txHash && (
        <div className="border border-tertiary bg-tertiary/5 p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-widest text-tertiary">
            Transaction Confirmed
          </p>
          <StellarLink
            value={txHash}
            type="tx"
            className="mt-2 max-w-full"
            linkClassName="text-xs"
          />
        </div>
      )}

      <div className="flex items-center justify-between border-b border-outline-variant pb-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Current Ledger
        </span>
        <span className="font-mono text-xs text-on-surface-variant">
          {currentLedger ? currentLedger.toLocaleString() : loading ? 'Loading...' : 'Unavailable'}
        </span>
      </div>

      {!loading && deposits.length === 0 && !error && (
        <div className="py-12 text-center">
          <p className="font-heading text-sm uppercase tracking-widest text-outline">No Deposits</p>
          <p className="mt-2 font-body text-xs text-on-surface-variant">
            No on-chain vault deposits found in the retained ledger range.
          </p>
        </div>
      )}

      {deposits.map((deposit) => {
        const actions = getVaultActions(deposit, address, stellarKeys);
        return (
          <div
            key={deposit.id}
            className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-4"
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 ${stateColors[deposit.state]}`} />
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {stateLabels[deposit.state]}
              </span>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Deposit ID
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="truncate font-mono text-xs text-primary">{deposit.id}</span>
                <CopyButton text={deposit.id} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Amount
                </span>
                <p className="font-heading text-base font-bold text-on-surface">
                  {deposit.amount} XLM
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Unlock Ledger
                </span>
                <p className="font-mono text-xs text-on-surface-variant">
                  {deposit.unlockLedger ? deposit.unlockLedger.toLocaleString() : 'Unavailable'}
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Time to Unlock
                </span>
                <p className="font-mono text-xs text-on-surface-variant">
                  {deposit.unlockLedger
                    ? formatCountdown(deposit.unlockLedger, currentLedger)
                    : 'Unavailable'}
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Refund Ledger
                </span>
                <p className="font-mono text-xs text-on-surface-variant">
                  {deposit.refundAfter ? deposit.refundAfter.toLocaleString() : 'Unavailable'}
                </p>
              </div>
            </div>

            {actions.canClaim && (
              <button
                onClick={() => void runAction('claim', deposit)}
                disabled={actionId === deposit.id}
                className="h-11 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface disabled:opacity-30"
              >
                {actionId === deposit.id ? 'Claiming...' : 'Claim'}
              </button>
            )}
            {actions.canRefund && (
              <button
                onClick={() => void runAction('refund', deposit)}
                disabled={actionId === deposit.id}
                className="h-11 w-full border border-error bg-error/5 font-heading text-[13px] font-semibold uppercase tracking-widest text-error disabled:opacity-30"
              >
                {actionId === deposit.id ? 'Refunding...' : 'Refund'}
              </button>
            )}

            {deposit.state === 'claimed' && (
              <p className="text-xs text-tertiary">Claimed by recipient.</p>
            )}
            {deposit.state === 'refunded' && (
              <p className="text-xs text-outline">Refunded to sender.</p>
            )}
            {deposit.state === 'failed' && (
              <p className="text-xs text-error">
                Contract state could not be resolved for this deposit.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
