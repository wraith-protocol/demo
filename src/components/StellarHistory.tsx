import { useState, useEffect } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';
import { stellarTxUrl } from '@/lib/explorer';

interface StellarTx {
  id: string;
  hash: string;
  created_at: string;
  source_account: string;
  fee_charged: string;
  successful: boolean;
  memo?: string;
}

export function StellarHistory() {
  const { address, isConnected } = useStellarWallet();
  const [txs, setTxs] = useState<StellarTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!address) return;

    const fetchHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `${STELLAR_NETWORK.horizonUrl}/accounts/${address}/transactions?limit=20&order=desc`,
        );
        if (!res.ok) throw new Error('Failed to fetch transaction history');
        const data = await res.json();
        setTxs(data._embedded.records);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [address]);

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
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Transaction History
        </h1>
      </div>

      {loading && (
        <div className="flex items-center gap-3 py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-tertiary border-t-transparent" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Fetching transactions...
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-4">
          <p className="font-body text-sm text-error">{error}</p>
        </div>
      )}

      {!loading && txs.length === 0 && !error && (
        <p className="font-body text-sm text-on-surface-variant">No transactions found.</p>
      )}

      <div className="flex flex-col gap-4">
        {txs.map((tx) => (
          <div
            key={tx.id}
            className="group flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container p-4 transition-colors hover:border-outline"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    tx.successful ? 'bg-secondary' : 'bg-error'
                  }`}
                />
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
                  {tx.successful ? 'Success' : 'Failed'}
                </span>
              </div>
              <span className="font-mono text-[10px] text-outline">
                {new Date(tx.created_at).toLocaleString()}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Hash
                </span>
                <a
                  href={stellarTxUrl(tx.hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-tertiary hover:underline"
                >
                  {tx.hash.slice(0, 12)}...{tx.hash.slice(-12)}
                </a>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Fee
                </span>
                <span className="font-mono text-[10px] text-on-surface">
                  {(parseFloat(tx.fee_charged) / 10000000).toFixed(7)} XLM
                </span>
              </div>
              {tx.memo && (
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Memo
                  </span>
                  <span className="max-w-[200px] truncate font-mono text-[10px] text-on-surface">
                    {tx.memo}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
