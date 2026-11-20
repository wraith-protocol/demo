import { ActivityEntry } from '@/stores/activityStore';
import { stellarTxUrl, horizenTxUrl, solanaTxUrl, ckbTxUrl } from '@/lib/explorer';
import { StellarLink } from '@/components/StellarLink';

interface ActivityRowProps {
  entry: ActivityEntry;
}

export function ActivityRow({ entry }: ActivityRowProps) {
  const isStellarAccount =
    entry.chain === 'stellar' && !!entry.recipient && /^[GM][A-Z2-7]+$/.test(entry.recipient);
  const getExplorerUrl = () => {
    switch (entry.chain) {
      case 'stellar':
        return stellarTxUrl(entry.id);
      case 'horizen':
        return horizenTxUrl(entry.id);
      case 'solana':
        return solanaTxUrl(entry.id);
      case 'ckb':
        return ckbTxUrl(entry.id);
      default:
        return '#';
    }
  };

  const getChainIcon = () => {
    switch (entry.chain) {
      case 'stellar':
        return (
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
            <path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="currentColor" />
          </svg>
        );
      case 'horizen':
        return (
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
            <path
              d="M8 3V13M5 6L8 3L11 6M5 10L8 13L11 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        );
      case 'solana':
        return (
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
            <path
              d="M3 8H13M8 3V13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        );
      case 'ckb':
        return (
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
            <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container p-4 transition-colors hover:border-outline">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {getChainIcon()}
          <span
            className={`h-2 w-2 rounded-full ${
              entry.status === 'confirmed'
                ? 'bg-secondary'
                : entry.status === 'pending'
                  ? 'bg-tertiary animate-pulse'
                  : 'bg-error'
            }`}
          />
          <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
            {entry.status} • {entry.kind.replace('-', ' ')}
          </span>
        </div>
        <span className="font-mono text-[10px] text-outline">
          {new Date(entry.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Direction
          </span>
          <span className="font-mono text-[10px] text-on-surface">
            {entry.direction === 'in' ? 'Incoming (Received)' : 'Outgoing (Sent)'}
          </span>
        </div>

        {entry.amount && (
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount
            </span>
            <span className="font-mono text-[10px] text-on-surface">
              {entry.amount} {entry.token || 'XLM'}
            </span>
          </div>
        )}

        {entry.recipient && (
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Recipient / Address
            </span>
            {isStellarAccount ? (
              <StellarLink
                value={entry.recipient!}
                type="account"
                className="max-w-[240px]"
                linkClassName="text-[10px]"
              />
            ) : (
              <span
                className="max-w-[200px] truncate font-mono text-[10px] text-on-surface"
                title={entry.recipient}
              >
                {entry.recipient.length > 30
                  ? `${entry.recipient.slice(0, 12)}...${entry.recipient.slice(-12)}`
                  : entry.recipient}
              </span>
            )}
          </div>
        )}

        {entry.kind !== 'stealth-receive' && (
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Hash
            </span>
            {entry.chain === 'stellar' ? (
              <StellarLink value={entry.id} type="tx" linkClassName="text-[10px]" />
            ) : (
              <a
                href={getExplorerUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-tertiary hover:underline"
              >
                {entry.id.slice(0, 12)}...{entry.id.slice(-12)}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
