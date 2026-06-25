import { useState, useEffect, useCallback } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';

type DepositState = 'pending' | 'claimed' | 'refunded';

interface VaultDeposit {
  id: string;
  recipient: string;
  amount: string;
  unlockLedger: number;
  refundWindow: number;
  state: DepositState;
  createdAt: number;
}

// Mock deposit data - will be replaced with contract calls
const MOCK_DEPOSITS: VaultDeposit[] = [
  {
    id: 'vault_1234567890',
    recipient: 'st:xlm:mock_recipient_1',
    amount: '10.5',
    unlockLedger: 500000,
    refundWindow: 10000,
    state: 'pending',
    createdAt: Date.now() - 86400000, // 1 day ago
  },
  {
    id: 'vault_9876543210',
    recipient: 'st:xlm:mock_recipient_2',
    amount: '25.0',
    unlockLedger: 450000,
    refundWindow: 10000,
    state: 'claimed',
    createdAt: Date.now() - 172800000, // 2 days ago
  },
  {
    id: 'vault_5555555555',
    recipient: 'st:xlm:mock_recipient_3',
    amount: '5.0',
    unlockLedger: 400000,
    refundWindow: 10000,
    state: 'refunded',
    createdAt: Date.now() - 259200000, // 3 days ago
  },
];

// Mock current ledger - will be replaced with actual ledger query
const MOCK_CURRENT_LEDGER = 480000;

function formatCountdown(targetLedger: number, currentLedger: number): string {
  const ledgersRemaining = targetLedger - currentLedger;
  if (ledgersRemaining <= 0) return 'Unlocked';
  
  // Approximate: ~5 seconds per ledger on Stellar
  const secondsRemaining = ledgersRemaining * 5;
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getStateColor(state: DepositState): string {
  switch (state) {
    case 'pending':
      return 'bg-primary';
    case 'claimed':
      return 'bg-tertiary';
    case 'refunded':
      return 'bg-outline';
    default:
      return 'bg-outline';
  }
}

function getStateLabel(state: DepositState): string {
  switch (state) {
    case 'pending':
      return 'Pending';
    case 'claimed':
      return 'Claimed';
    case 'refunded':
      return 'Refunded';
    default:
      return 'Unknown';
  }
}

export function VaultStatusTable() {
  const { address } = useStellarWallet();
  const [deposits, setDeposits] = useState<VaultDeposit[]>(MOCK_DEPOSITS);
  const [currentLedger, setCurrentLedger] = useState(MOCK_CURRENT_LEDGER);
  const [, setTick] = useState(0);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundError, setRefundError] = useState('');
  const [refundTxHash, setRefundTxHash] = useState<string | null>(null);

  // Update countdown every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
      // Simulate ledger progression
      setCurrentLedger((prev) => prev + 12); // ~1 minute worth of ledgers
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const handleRefund = useCallback(async (depositId: string) => {
    if (!address) {
      setRefundError('Wallet not connected');
      return;
    }

    setRefundingId(depositId);
    setRefundError('');

    try {
      // TODO: Integrate with stealth-vault contract when available
      // For now, simulate the refund flow
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate transaction hash
      const simulatedTxHash = `refund_${depositId}_${Date.now()}`;
      setRefundTxHash(simulatedTxHash);

      // Update deposit state
      setDeposits((prev) =>
        prev.map((d) => (d.id === depositId ? { ...d, state: 'refunded' as const } : d)),
      );
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setRefundingId(null);
    }
  }, [address]);

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

  if (deposits.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-heading text-sm uppercase tracking-widest text-outline">
          No Deposits
        </p>
        <p className="mt-2 font-body text-xs text-on-surface-variant">
          No vault deposits found.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {refundError && <p className="text-sm text-error">{refundError}</p>}

      {refundTxHash && (
        <div className="flex flex-col gap-3 border border-tertiary bg-tertiary/5 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-tertiary">
              Refund Successful
            </span>
          </div>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Transaction Hash
            </span>
            <div className="mt-0.5 flex items-center gap-2">
              <a
                href={stellarTxUrl(refundTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary underline"
              >
                {refundTxHash}
              </a>
              <CopyButton text={refundTxHash} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-outline-variant pb-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Current Ledger
        </span>
        <span className="font-mono text-xs text-on-surface-variant">
          {currentLedger.toLocaleString()}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {deposits.map((deposit) => {
          const unlockCountdown = formatCountdown(deposit.unlockLedger, currentLedger);
          const refundDeadline = deposit.unlockLedger + deposit.refundWindow;
          const refundCountdown = formatCountdown(refundDeadline, currentLedger);
          const isUnlocked = currentLedger >= deposit.unlockLedger;
          const canRefund = currentLedger >= refundDeadline && deposit.state === 'pending';

          return (
            <div
              key={deposit.id}
              className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 ${getStateColor(deposit.state)}`}></span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      {getStateLabel(deposit.state)}
                    </span>
                  </div>

                  <div className="mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Deposit ID
                    </span>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-xs text-primary">{deposit.id}</span>
                      <CopyButton text={deposit.id} />
                    </div>
                  </div>

                  <div className="mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Amount
                    </span>
                    <div className="mt-0.5 font-heading text-base font-bold text-on-surface">
                      {deposit.amount} XLM
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                        Unlock Ledger
                      </span>
                      <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                        {deposit.unlockLedger.toLocaleString()}
                      </div>
                    </div>

                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                        Time to Unlock
                      </span>
                      <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                        {unlockCountdown}
                      </div>
                    </div>

                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                        Refund Deadline
                      </span>
                      <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                        {refundDeadline.toLocaleString()}
                      </div>
                    </div>

                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                        Refund Window
                      </span>
                      <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                        {refundCountdown}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {deposit.state === 'pending' && (
                <div className="border-t border-outline-variant/30 pt-3">
                  {isUnlocked && !canRefund && (
                    <p className="font-body text-xs text-tertiary">
                      Unlock time reached. Recipient can now claim.
                    </p>
                  )}
                  {canRefund && (
                    <div className="flex flex-col gap-2">
                      <p className="font-body text-xs text-error">
                        Refund window open. Sender can now refund.
                      </p>
                      <button
                        onClick={() => handleRefund(deposit.id)}
                        disabled={refundingId === deposit.id}
                        className="h-11 w-full border border-error bg-error/5 font-heading text-[13px] font-semibold uppercase tracking-widest text-error transition-colors hover:bg-error/10 disabled:opacity-30"
                      >
                        {refundingId === deposit.id ? 'Refunding...' : 'Refund'}
                      </button>
                    </div>
                  )}
                  {!isUnlocked && (
                    <p className="font-body text-xs text-on-surface-variant">
                      Waiting for unlock time...
                    </p>
                  )}
                </div>
              )}

              {deposit.state === 'claimed' && (
                <div className="border-t border-outline-variant/30 pt-3">
                  <p className="font-body text-xs text-tertiary">
                    Successfully claimed by recipient.
                  </p>
                </div>
              )}

              {deposit.state === 'refunded' && (
                <div className="border-t border-outline-variant/30 pt-3">
                  <p className="font-body text-xs text-outline">
                    Refunded by sender.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
