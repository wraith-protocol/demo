import { useState, useMemo } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  useActivityStore,
  ActivityKind,
  ActivityStatus,
  ActivityEntry,
} from '@/stores/activityStore';
import { ActivityRow } from '@/components/ActivityRow';

export default function Activity() {
  const { address } = useStellarWallet();
  const { entries, clearHistory } = useActivityStore();

  const [filterChain, setFilterChain] = useState<'all' | 'horizen' | 'stellar' | 'solana' | 'ckb'>(
    'all',
  );
  const [filterKind, setFilterKind] = useState<ActivityKind | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ActivityStatus | 'all'>('all');

  const walletEntries = useMemo(() => {
    if (!address) return [];
    return entries.filter((e: ActivityEntry) => e.wallet === address);
  }, [entries, address]);

  const filteredEntries = useMemo(() => {
    return walletEntries
      .filter((e: ActivityEntry) => {
        if (filterChain !== 'all' && e.chain !== filterChain) return false;
        if (filterKind !== 'all' && e.kind !== filterKind) return false;
        if (filterStatus !== 'all' && e.status !== filterStatus) return false;
        return true;
      })
      .sort((a: ActivityEntry, b: ActivityEntry) => b.timestamp - a.timestamp);
  }, [walletEntries, filterChain, filterKind, filterStatus]);

  if (!address) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Activity
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your wallet to view your transaction history.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Multi-Chain Activity
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Activity History
          </h1>
        </div>
        <button
          onClick={() => clearHistory(filterChain === 'all' ? 'stellar' : filterChain, address)}
          className="rounded-lg bg-surface-container px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:bg-error/20 hover:text-error"
        >
          Clear History
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Chain
          </label>
          <select
            value={filterChain}
            onChange={(e) => setFilterChain(e.target.value as any)}
            className="rounded-lg border border-outline bg-surface-container px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
          >
            <option value="all">All Chains</option>
            <option value="stellar">Stellar</option>
            <option value="horizen">Horizen</option>
            <option value="solana">Solana</option>
            <option value="ckb">CKB</option>
          </select>
        </div>
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
        <p className="font-body text-sm text-on-surface-variant">No activity recorded yet.</p>
      )}

      {walletEntries.length > 0 && filteredEntries.length === 0 && (
        <p className="font-body text-sm text-on-surface-variant">
          No activity matches the filters.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {filteredEntries.map((tx: ActivityEntry) => (
          <ActivityRow key={tx.id} entry={tx} />
        ))}
      </div>
    </section>
  );
}
