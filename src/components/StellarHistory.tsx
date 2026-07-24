import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl } from '@/lib/explorer';
import { useActivityStore, ActivityKind, ActivityStatus } from '@/stores/activityStore';
import { EmptyState } from '@/components/EmptyState';

export function StellarHistory() {
  const navigate = useNavigate();
  const { address, isConnected } = useStellarWallet();
  const { entries, clearHistory, pollPending } = useActivityStore();

  const [filterKind, setFilterKind] = useState<ActivityKind | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ActivityStatus | 'all'>('all');

  // Poll for pending transactions on mount and every 10 seconds
  useEffect(() => {
    if (!address) return;
    pollPending();
    const interval = setInterval(pollPending, 10000);
    return () => clearInterval(interval);
  }, [address, pollPending]);

  const walletEntries = useMemo(() => {
    if (!address) return [];
    return entries.filter((e) => e.wallet === address && e.chain === 'stellar');
  }, [entries, address]);

  const filteredEntries = useMemo(() => {
    return walletEntries
      .filter((e) => {
        if (filterKind !== 'all' && e.kind !== filterKind) return false;
        if (filterStatus !== 'all' && e.status !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [walletEntries, filterKind, filterStatus]);

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          History
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Stellar wallet to view your transaction history.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stellar Testnet / XLM
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Activity History
          </h1>
        </div>
        <button
          onClick={() => clearHistory('stellar', address ?? '')}
          className="rounded-lg bg-surface-container px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:bg-error/20 hover:text-error"
        >
          Clear History
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Type
          </label>
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as any)}
            className="rounded-lg border border-outline bg-surface-container px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
          >
            <option value="all">All Types</option>
            <option value="stealth-send">Stealth Send</option>
            <option value="stealth-receive">Stealth Receive</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="name-registration">Name Registration</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="rounded-lg border border-outline bg-surface-container px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {walletEntries.length === 0 && (
        <EmptyState
          illustration={
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="6" y="6" width="36" height="36" rx="0" />
              <line x1="14" y1="18" x2="34" y2="18" />
              <line x1="14" y1="24" x2="30" y2="24" />
              <line x1="14" y1="30" x2="26" y2="30" />
              <circle cx="36" cy="34" r="6" fill="currentColor" opacity="0.2" />
              <path d="M34 34l2 2 4-4" />
            </svg>
          }
          title="No activity yet"
          description="Your payment activity will show up here. Send or receive a stealth payment to get started."
          primaryCTA={{ label: 'Send your first payment', onClick: () => navigate('/send') }}
        />
      )}

      {walletEntries.length > 0 && filteredEntries.length === 0 && (
        <EmptyState
          title="No matches"
          description="No activity matches the current filters. Try selecting a different type or status."
        />
      )}

      <div className="flex flex-col gap-4">
        {filteredEntries.map((tx) => (
          <div
            key={tx.id}
            className="group flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container p-4 transition-colors hover:border-outline"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    tx.status === 'confirmed'
                      ? 'bg-secondary'
                      : tx.status === 'pending'
                        ? 'bg-tertiary animate-pulse'
                        : 'bg-error'
                  }`}
                />
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
                  {tx.status} • {tx.kind.replace('-', ' ')}
                </span>
              </div>
              <span className="font-mono text-[10px] text-outline">
                {new Date(tx.timestamp).toLocaleString()}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Direction
                </span>
                <span className="font-mono text-[10px] text-on-surface">
                  {tx.direction === 'in' ? 'Incoming (Received)' : 'Outgoing (Sent)'}
                </span>
              </div>

              {tx.amount && (
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Amount
                  </span>
                  <span className="font-mono text-[10px] text-on-surface">{tx.amount} XLM</span>
                </div>
              )}

              {tx.recipient && (
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Recipient / Address
                  </span>
                  <span
                    className="max-w-[200px] truncate font-mono text-[10px] text-on-surface"
                    title={tx.recipient}
                  >
                    {tx.recipient.length > 30
                      ? `${tx.recipient.slice(0, 12)}...${tx.recipient.slice(-12)}`
                      : tx.recipient}
                  </span>
                </div>
              )}

              {tx.kind !== 'stealth-receive' && (
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Hash
                  </span>
                  <a
                    href={stellarTxUrl(tx.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] text-tertiary hover:underline"
                  >
                    {tx.id.slice(0, 12)}...{tx.id.slice(-12)}
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
