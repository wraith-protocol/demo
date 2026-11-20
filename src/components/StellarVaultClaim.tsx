import { useState, useCallback } from 'react';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/stellar';
import { CopyButton } from '@/components/CopyButton';
import { NetworkMismatchModal } from '@/components/NetworkMismatchModal';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useActivityStore } from '@/stores/activityStore';
import { StellarLink } from '@/components/StellarLink';
import { STELLAR_VAULT_CONTRACT_ID } from '@/config';
import {
  loadClaimableVaultDeposits,
  submitVaultClaim,
  formatVaultAmount,
  type ClaimableVaultDeposit,
} from '@/lib/stellar/vaultClaim';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export function StellarVaultClaim() {
  const { address, signMessage, signTransaction, isNetworkMismatch } = useStellarWallet();
  const { stellarKeys, setStellarKeys, setStellarMetaAddress } = useStealthKeys();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [deposits, setDeposits] = useState<ClaimableVaultDeposit[]>([]);
  const [currentLedger, setCurrentLedger] = useState<number | null>(null);
  const [loadError, setLoadError] = useState('');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const [claimedHashes, setClaimedHashes] = useState<Record<string, string>>({});
  const [showNetworkModal, setShowNetworkModal] = useState(false);

  const deriveKeys = useCallback(async () => {
    setIsDerivingKeys(true);
    setLoadError('');
    try {
      const signature = await signMessage(STEALTH_SIGNING_MESSAGE);
      const derived = deriveStealthKeys(signature);
      setStellarKeys(derived);
      setStellarMetaAddress(
        encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey),
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  }, [signMessage, setStellarKeys, setStellarMetaAddress]);

  const loadDeposits = useCallback(async () => {
    if (!address || !stellarKeys) return;

    setLoadState('loading');
    setLoadError('');
    setClaimError('');

    try {
      const result = await loadClaimableVaultDeposits({
        vaultContractId: STELLAR_VAULT_CONTRACT_ID,
        sourceAddress: address,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      });
      setDeposits(result.deposits);
      setCurrentLedger(result.currentLedger);
      setLoadState('loaded');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load claimable deposits');
      setLoadState('error');
    }
  }, [address, stellarKeys]);

  const handleClaim = useCallback(
    async (deposit: ClaimableVaultDeposit) => {
      if (!address) return;

      if (isNetworkMismatch) {
        setShowNetworkModal(true);
        return;
      }

      setClaimingId(deposit.depositId);
      setClaimError('');

      try {
        const result = await submitVaultClaim({
          vaultContractId: STELLAR_VAULT_CONTRACT_ID,
          sourceAddress: address,
          deposit,
          signWalletTransaction: signTransaction,
        });

        addActivity({
          id: result.txHash,
          chain: 'stellar',
          wallet: address,
          kind: 'vault-claim',
          direction: 'in',
          status: 'pending',
          amount: formatVaultAmount(deposit.amount, deposit.assetDecimals),
          token: deposit.assetLabel,
          timestamp: Date.now(),
        });
        updateActivity(result.txHash, 'confirmed');

        setClaimedHashes((prev) => ({ ...prev, [deposit.depositId]: result.txHash }));
        setDeposits((prev) => prev.filter((d) => d.depositId !== deposit.depositId));
      } catch (err) {
        setClaimError(err instanceof Error ? err.message : 'Claim failed');
        // The deposit may have been claimed or refunded elsewhere in the meantime.
        await loadDeposits();
      } finally {
        setClaimingId(null);
      }
    },
    [address, isNetworkMismatch, signTransaction, addActivity, updateActivity, loadDeposits],
  );

  if (!address) {
    return (
      <div className="py-12 text-center">
        <p className="font-heading text-sm uppercase tracking-widest text-outline">
          Connect Wallet
        </p>
        <p className="mt-2 font-body text-xs text-on-surface-variant">
          Connect your Freighter wallet to claim vault deposits.
        </p>
      </div>
    );
  }

  if (!STELLAR_VAULT_CONTRACT_ID) {
    return (
      <div className="py-12 text-center">
        <p className="font-heading text-sm uppercase tracking-widest text-outline">
          Vault Not Configured
        </p>
        <p className="mt-2 font-body text-xs text-on-surface-variant">
          Set VITE_STELLAR_VAULT_CONTRACT_ID to the deployed stealth-vault contract for this
          network.
        </p>
      </div>
    );
  }

  if (!stellarKeys) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div>
          <p className="font-heading text-sm uppercase tracking-widest text-outline">
            Derive Stealth Keys
          </p>
          <p className="mt-2 font-body text-xs text-on-surface-variant">
            Sign a message to derive the keys used to find and claim your vault deposits.
          </p>
        </div>
        {loadError && <p className="text-sm text-error">{loadError}</p>}
        <button
          onClick={deriveKeys}
          disabled={isDerivingKeys}
          className="h-11 border border-outline-variant px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
        >
          {isDerivingKeys ? 'Deriving...' : 'Derive Keys'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loadState !== 'loaded' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-body text-xs text-on-surface-variant">
            Scan the announcer contract for vault deposits addressed to your derived stealth keys.
          </p>
          {loadError && <p className="text-sm text-error">{loadError}</p>}
          <button
            onClick={loadDeposits}
            disabled={loadState === 'loading'}
            className="h-11 border border-outline-variant px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
          >
            {loadState === 'loading' ? 'Scanning...' : 'Load Claimable Deposits'}
          </button>
        </div>
      )}

      {loadState === 'loaded' && (
        <>
          <div className="flex items-center justify-between border-b border-outline-variant pb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Current Ledger
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-on-surface-variant">
                {currentLedger?.toLocaleString() ?? '—'}
              </span>
              <button
                onClick={loadDeposits}
                className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                Refresh
              </button>
            </div>
          </div>

          {claimError && <p className="text-sm text-error">{claimError}</p>}

          {deposits.length === 0 && Object.keys(claimedHashes).length === 0 && (
            <div className="py-12 text-center">
              <p className="font-heading text-sm uppercase tracking-widest text-outline">
                No Claimable Deposits
              </p>
              <p className="mt-2 font-body text-xs text-on-surface-variant">
                No pending vault deposits found for your derived stealth addresses.
              </p>
            </div>
          )}

          {Object.entries(claimedHashes).map(([depositId, txHash]) => (
            <div
              key={depositId}
              className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5"
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
                <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
                  Claim Successful
                </span>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Transaction Hash
                </span>
                <StellarLink
                  value={txHash}
                  type="tx"
                  className="mt-0.5 max-w-full"
                  linkClassName="text-xs"
                />
              </div>
            </div>
          ))}

          {deposits.map((deposit) => (
            <div
              key={deposit.depositId}
              className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 ${deposit.isUnlocked ? 'bg-tertiary' : 'bg-primary'}`}
                    ></span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      {deposit.isUnlocked ? 'Claimable' : 'Pending Unlock'}
                    </span>
                    {deposit.isRefundable && (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-error">
                        Refundable — claim soon
                      </span>
                    )}
                  </div>

                  <div className="mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Deposit ID
                    </span>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-xs text-primary">
                        {deposit.depositId.slice(0, 12)}…{deposit.depositId.slice(-8)}
                      </span>
                      <CopyButton text={deposit.depositId} />
                    </div>
                  </div>

                  <div className="mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Amount
                    </span>
                    <div className="mt-0.5 font-heading text-lg font-bold text-on-surface">
                      {formatVaultAmount(deposit.amount, deposit.assetDecimals)}{' '}
                      {deposit.assetLabel}
                    </div>
                  </div>

                  <div className="mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Unlock Ledger
                    </span>
                    <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                      {deposit.unlockLedger.toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Refund Ledger
                    </span>
                    <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                      {deposit.refundAfter.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleClaim(deposit)}
                disabled={!deposit.isUnlocked || claimingId === deposit.depositId}
                className="h-11 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
              >
                {claimingId === deposit.depositId
                  ? 'Claiming...'
                  : deposit.isUnlocked
                    ? 'Claim'
                    : 'Not Yet Unlocked'}
              </button>
            </div>
          ))}
        </>
      )}

      {showNetworkModal && <NetworkMismatchModal onClose={() => setShowNetworkModal(false)} />}
    </div>
  );
}
