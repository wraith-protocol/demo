import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityRow } from '@/components/ActivityRow';
import { EmptyState } from '@/components/EmptyState';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  useActivityStore,
  type ActivityEntry,
  type ActivityKind,
  type ActivityStatus,
} from '@/stores/activityStore';
import { downloadActivityCsv, downloadActivityJson } from '@/utils/activityExport';

type HistoryChain = 'all' | 'horizen' | 'stellar' | 'solana' | 'ckb';

const CHAINS: HistoryChain[] = ['all', 'horizen', 'stellar', 'solana', 'ckb'];

export default function History() {
  const navigate = useNavigate();
  // Scope all reads to the connected wallet address so entries from other
  // wallets/profiles are never visible or exportable from this session.
  const { address } = useStellarWallet();
  const { entries, clearHistory } = useActivityStore();
  const [filterKind, setFilterKind] = useState<ActivityKind | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ActivityStatus | 'all'>('all');
  const [filterChain, setFilterChain] = useState<HistoryChain>('all');

  // Only the entries that belong to the currently connected wallet.
  const walletEntries = useMemo(() => {
    if (!address) return [];
    return entries.filter((entry: ActivityEntry) => entry.wallet === address);
  }, [entries, address]);

  const filteredEntries = useMemo(() => {
    return walletEntries
      .filter((entry: ActivityEntry) => {
        if (filterChain !== 'all' && entry.chain !== filterChain) return false;
        if (filterKind !== 'all' && entry.kind !== filterKind) return false;
        if (filterStatus !== 'all' && entry.status !== filterStatus) return false;
        return true;
      })
      .sort((a: ActivityEntry, b: ActivityEntry) => b.timestamp - a.timestamp);
  }, [walletEntries, filterChain, filterKind, filterStatus]);

  // Exports are scoped to the current filter view and deliberately omit
  // `metadata` so private key and memo material is never leaked into downloads.
  const exportEntries = useMemo(
    () => filteredEntries.map(({ metadata: _metadata, ...rest }) => rest),
    [filteredEntries],
  );

  if (!address) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Activity History
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
          onClick={() => clearHistory(filterChain, address)}
          disabled={walletEntries.length === 0}
          className="rounded-lg bg-surface-container px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:bg-error/20 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear History
        </button>
      </div>

      <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="history-kind"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Type
            </label>
            <select
              id="history-kind"
              value={filterKind}
              onChange={(event) => setFilterKind(event.target.value as ActivityKind | 'all')}
              className="rounded-lg border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
            >
              <option value="all">All Types</option>
              <option value="stealth-send">Stealth Send</option>
              <option value="stealth-receive">Stealth Receive</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="name-registration">Name Registration</option>
              <option value="vault-claim">Vault Claim</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="history-status"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Status
            </label>
            <select
              id="history-status"
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

          <div className="flex flex-col gap-1">
            <label
              htmlFor="history-chain"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Chain
            </label>
            <select
              id="history-chain"
              value={filterChain}
              onChange={(event) => setFilterChain(event.target.value as HistoryChain)}
              className="rounded-lg border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none focus:border-tertiary"
            >
              {CHAINS.map((chain) => (
                <option key={chain} value={chain}>
                  {chain === 'all'
                    ? 'All Chains'
                    : `${chain.charAt(0).toUpperCase()}${chain.slice(1)}`}
                </option>
              ))}
            </select>
          </div>

          <span className="pb-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-4">
          <button
            type="button"
            onClick={() => downloadActivityCsv(exportEntries)}
            disabled={filteredEntries.length === 0}
            className="border border-outline px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:border-tertiary hover:text-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => downloadActivityJson(exportEntries)}
            disabled={filteredEntries.length === 0}
            className="border border-outline px-4 py-2 font-mono text-xs uppercase tracking-widest text-on-surface transition-colors hover:border-tertiary hover:text-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export JSON
          </button>
          <p className="basis-full font-body text-xs text-outline">
            Exports include only the entries matching the current filters. Private key and memo
            material is never included.
          </p>
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
          title="No activity recorded yet."
          description="Send or receive a stealth payment to see your history here."
          primaryCTA={{ label: 'Send your first payment', onClick: () => navigate('/send') }}
        />
      )}

      {walletEntries.length > 0 && filteredEntries.length === 0 && (
        <EmptyState
          title="No matches"
          description="No activity matches the current filters. Try selecting a different type, status, or chain."
        />
      )}

      <div className="flex flex-col gap-4">
        {filteredEntries.map((entry: ActivityEntry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}
