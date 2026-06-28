import { useState, useCallback } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';

type ClaimState = 'idle' | 'signing' | 'claiming' | 'success';

// Mock deposit data - will be replaced with contract calls
const MOCK_DEPOSITS = [
  {
    id: 'vault_1234567890',
    recipient: 'st:xlm:mock_recipient_1',
    amount: '10.5',
    unlockLedger: 500000,
    refundWindow: 10000,
    state: 'pending' as const,
  },
  {
    id: 'vault_9876543210',
    recipient: 'st:xlm:mock_recipient_2',
    amount: '25.0',
    unlockLedger: 450000,
    refundWindow: 10000,
    state: 'pending' as const,
  },
];

export function StellarVaultClaim() {
  const { address, signMessage, signTransaction } = useStellarWallet();
  const [deposits, setDeposits] = useState(MOCK_DEPOSITS);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>('idle');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleClaim = useCallback(async (depositId: string) => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setClaimingId(depositId);
    setClaimState('signing');
    setError('');

    try {
      // Step 1: Sign message to prove recipient identity
      const signingMessage = `Claim vault deposit: ${depositId}`;
      const signature = await signMessage(signingMessage);

      setClaimState('claiming');

      // TODO: Integrate with stealth-vault contract when available
      // For now, simulate the claim flow
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate transaction hash
      const simulatedTxHash = `claim_${depositId}_${Date.now()}`;
      setTxHash(simulatedTxHash);
      setClaimState('success');

      // Update deposit state
      setDeposits((prev) =>
        prev.map((d) => (d.id === depositId ? { ...d, state: 'claimed' as const } : d)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
      setClaimState('idle');
    } finally {
      setClaimingId(null);
    }
  }, [address, signMessage]);

  const reset = () => {
    setClaimState('idle');
    setTxHash(null);
    setError('');
  };

  const claimableDeposits = deposits.filter((d) => d.state === 'pending');

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

  if (claimState === 'success' && txHash) {
    return (
      <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
          <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
            Claim Successful
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Transaction Hash
            </span>
            <div className="mt-0.5 flex items-center gap-2">
              <a
                href={stellarTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary underline"
              >
                {txHash}
              </a>
              <CopyButton text={txHash} />
            </div>
          </div>
        </div>

        <button
          onClick={reset}
          className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
        >
          Claim Another
        </button>
      </div>
    );
  }

  if (claimableDeposits.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-heading text-sm uppercase tracking-widest text-outline">
          No Claimable Deposits
        </p>
        <p className="mt-2 font-body text-xs text-on-surface-variant">
          No pending vault deposits found for your address.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-error">{error}</p>}

      {claimableDeposits.map((deposit) => (
        <div
          key={deposit.id}
          className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-primary"></span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Pending
                </span>
              </div>

              <div className="mb-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Deposit ID
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-xs text-primary">{deposit.id}</span>
                  <CopyButton text={deposit.id} />
                </div>
              </div>

              <div className="mb-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Amount
                </span>
                <div className="mt-0.5 font-heading text-lg font-bold text-on-surface">
                  {deposit.amount} XLM
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
                  Refund Window
                </span>
                <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                  {deposit.refundWindow.toLocaleString()} ledgers
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => handleClaim(deposit.id)}
            disabled={claimingId === deposit.id || claimState !== 'idle'}
            className="h-11 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {claimingId === deposit.id
              ? claimState === 'signing'
                ? 'Signing...'
                : 'Claiming...'
              : 'Claim'}
          </button>
        </div>
      ))}
    </div>
  );
}
