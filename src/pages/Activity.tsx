import { useMemo, useState } from 'react';
import { ActivityRow } from '@/components/ActivityRow';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  useActivityStore,
  type ActivityEntry,
  type ActivityKind,
  type ActivityStatus,
} from '@/stores/activityStore';
import { downloadActivityCsv, downloadActivityJson } from '@/utils/activityExport';

type ActivityChain = 'horizen' | 'stellar' | 'solana' | 'ckb';

export default function Activity() {
  const { address } = useStellarWallet();
  const { entries, clearHistory } = useActivityStore();
  const [filterChain, setFilterChain] = useState<ActivityChain | 'all'>('all');
  const [filterKind, setFilterKind] = useState<ActivityKind | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ActivityStatus | 'all'>('all');

  const walletEntries = useMemo(() => {
    if (!address) return [];
    return entries.filter((entry: ActivityEntry) => entry.wallet === address);
  }, [entries, address]);

  const filteredEntries = useMemo(
    () =>
      walletEntries
        .filter((entry: ActivityEntry) => {
          if (filterChain !== 'all' && entry.chain !== filterChain) return false;
          if (filterKind !== 'all' && entry.kind !== filterKind) return false;
          if (filterStatus !== 'all' && entry.status !== filterStatus) return false;
          return true;
        })
        .sort((a: ActivityEntry, b: ActivityEntry) => b.timestamp - a.timestamp),
    [walletEntries, filterChain, filterKind, filterStatus],
  );

  if (!address) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Activity
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your wallet to view and export your transaction history.
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
          type="button"
          onClick={() => clearHistory(filterChain === 'all' ? 'stellar' : filterChain, address)}
          className="rounded-lg bg-surface-container px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:bg-error/20 hover:text-error"
        >
          Clear History
        </button>
      </div>

      <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-chain"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Chain
            </label>
            <select
              id="activity-chain"
              value={filterChain}
              onChange={(event) => setFilterChain(event.target.value as ActivityChain | 'all')}
              className="rounded-lg border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
            >
              <option value="all">All Chains</option>
              <option value="stellar">Stellar</option>
              <option value="horizen">Horizen</option>
              <option value="solana">Solana</option>
              <option value="ckb">CKB</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-kind"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Type
            </label>
            <select
              id="activity-kind"
              value={filterKind}
              onChange={(event) => setFilterKind(event.target.value as ActivityKind | 'all')}
              className="rounded-lg border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
            >
              <option value="all">All Types</option>
              <option value="stealth-send">Stealth Send</option>
              <option value="stealth-receive">Stealth Receive</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="name-registration">Name Registration</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-status"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Status
            </label>
            <select
              id="activity-status"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value as ActivityStatus | 'all')}
              className="rounded-lg border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <span className="pb-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-4">
          <button
            type="button"
            onClick={() => downloadActivityCsv(filteredEntries)}
            disabled={filteredEntries.length === 0}
            className="border border-outline px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:border-tertiary hover:text-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => downloadActivityJson(filteredEntries)}
            disabled={filteredEntries.length === 0}
            className="border border-outline px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:border-tertiary hover:text-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export JSON
          </button>
          <p className="basis-full font-body text-xs text-outline">
            Exports include only the entries matching the current chain, type, and status filters.
          </p>
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
        {filteredEntries.map((entry: ActivityEntry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}
