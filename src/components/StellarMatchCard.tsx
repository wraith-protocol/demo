import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';

export interface StellarMatchCardProps {
  stealthAddress: string;
  scalarHex: string;
  balance: string | null;
  balanceState: 'loading' | 'loaded' | 'error';
  dest: string;
  withdrawing: boolean;
  withdrawHash: string | null;
  feeBumpHash: string | null;
  error: string;
  showKey: boolean;
  showSponsorPrompt: boolean;
  onDestChange: (value: string) => void;
  onWithdraw: () => void;
  onSponsoredWithdraw: () => void;
  onCancelSponsor: () => void;
  onRevealKey: () => void;
}

export function StellarMatchCard({
  stealthAddress,
  scalarHex,
  balance,
  balanceState,
  dest,
  withdrawing,
  withdrawHash,
  feeBumpHash,
  error,
  showKey,
  showSponsorPrompt,
  onDestChange,
  onWithdraw,
  onSponsoredWithdraw,
  onCancelSponsor,
  onRevealKey,
}: StellarMatchCardProps) {
  const hasBalance = balanceState === 'loaded' && balance != null && parseFloat(balance) > 0;

  return (
    <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stealth Address
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <a
              href={stellarAddrUrl(stealthAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-xs text-primary underline"
            >
              {stealthAddress}
            </a>
            <CopyButton text={stealthAddress} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {balanceState === 'loading' ? (
            <span className="font-mono text-xs text-outline">...</span>
          ) : balanceState === 'error' ? (
            <span className="font-mono text-xs text-error">Balance error</span>
          ) : hasBalance ? (
            <>
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
              <span className="font-heading text-lg font-bold text-on-surface">{balance} XLM</span>
            </>
          ) : (
            <span className="font-mono text-xs text-outline">Empty</span>
          )}
        </div>
      </div>

      {!withdrawHash && hasBalance && (
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Withdraw to
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dest}
              onChange={(e) => onDestChange(e.target.value)}
              placeholder="Destination address (G...)"
              className="h-10 flex-1 border border-outline-variant bg-surface px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
            />
            <button
              onClick={onWithdraw}
              disabled={!dest || withdrawing}
              className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? '...' : 'Withdraw'}
            </button>
          </div>
        </div>
      )}

      {showSponsorPrompt && (
        <div className="border border-tertiary bg-tertiary/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-tertiary">
              Sponsored Withdrawal Required
            </span>
          </div>
          <p className="mb-3 font-body text-xs leading-relaxed text-on-surface-variant">
            This stealth address can't pay its own fees. Your connected wallet will sponsor the
            transaction and pay the fee. Freighter will prompt you to sign the fee-bump transaction.
          </p>
          <p className="mb-4 font-body text-xs leading-relaxed text-on-surface-variant">
            The entire balance (including base reserve) will be merged into the destination address.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onSponsoredWithdraw}
              disabled={withdrawing}
              className="h-10 flex-1 bg-tertiary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? 'Processing...' : 'Pay with Connected Wallet'}
            </button>
            <button
              onClick={onCancelSponsor}
              disabled={withdrawing}
              className="h-10 border border-outline-variant px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright disabled:opacity-30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {feeBumpHash ? 'Sponsored withdrawal complete' : 'Withdrawn'} —{' '}
              <a
                href={stellarTxUrl(withdrawHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {withdrawHash.slice(0, 14)}...
              </a>
            </span>
          </div>
          {feeBumpHash && (
            <p className="font-body text-[10px] leading-relaxed text-on-surface-variant">
              Fee-bump transaction sponsored by your connected wallet. All funds including base
              reserve have been recovered.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/30 pt-3">
        {!showKey ? (
          <button
            onClick={onRevealKey}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            Reveal secret key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
                Stealth Key
              </span>
              <CopyButton text={scalarHex} />
            </div>
            <code className="break-all font-mono text-[11px] text-on-surface">{scalarHex}</code>
          </div>
        )}
      </div>
    </div>
  );
}
