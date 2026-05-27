import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';

export interface StellarSendViewProps {
  isConnected: boolean;
  recipient: string;
  amount: string;
  recipientError: string;
  showRecipientError: boolean;
  amountError: string;
  showAmountError: boolean;
  amountInvalid: boolean;
  balanceText: string;
  balanceIsError: boolean;
  error: string;
  canSubmit: boolean;
  isPending: boolean;
  stealthResult: { stealthAddress: string } | null;
  txHash: string | null;
  isSuccess: boolean;
  onRecipientChange: (value: string) => void;
  onRecipientBlur: () => void;
  onAmountChange: (value: string) => void;
  onAmountBlur: () => void;
  onPaste: () => void;
  onSend: () => void;
  onReset: () => void;
}

export function StellarSendView({
  isConnected,
  recipient,
  amount,
  recipientError,
  showRecipientError,
  amountError,
  showAmountError,
  amountInvalid,
  balanceText,
  balanceIsError,
  error,
  canSubmit,
  isPending,
  stealthResult,
  txHash,
  isSuccess,
  onRecipientChange,
  onRecipientBlur,
  onAmountChange,
  onAmountBlur,
  onPaste,
  onSend,
  onReset,
}: StellarSendViewProps) {
  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to send stealth payments on Stellar.
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
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Send XLM privately using stealth addresses. The recipient gets funds at a fresh address
          only they can control.
        </p>
      </div>

      {!stealthResult && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Recipient Meta-Address
            </label>
            <div className="relative">
              <input
                id="stellar-recipient"
                type="text"
                value={recipient}
                onChange={(e) => onRecipientChange(e.target.value)}
                onBlur={onRecipientBlur}
                aria-invalid={!!recipientError}
                aria-describedby="stellar-recipient-error"
                placeholder="st:xlm:..."
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={onPaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                Paste
              </button>
            </div>
            <p
              id="stellar-recipient-error"
              className="min-h-5 text-xs text-error"
              aria-live="polite"
            >
              {showRecipientError && recipientError ? recipientError : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount
            </label>
            <div className="relative">
              <input
                id="stellar-amount"
                type="text"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                onBlur={onAmountBlur}
                aria-invalid={amountInvalid}
                aria-describedby="stellar-amount-error stellar-balance-error"
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                XLM
              </span>
            </div>
            <p id="stellar-amount-error" className="min-h-5 text-xs text-error" aria-live="polite">
              {showAmountError && amountError ? amountError : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Network fee
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">100 stroops</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Announcer contract
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">Soroban</span>
            </div>
            <div className="flex min-h-5 items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Source balance
              </span>
              <span
                id="stellar-balance-error"
                className={`font-mono text-[10px] ${
                  balanceIsError ? 'text-error' : 'text-on-surface-variant'
                }`}
                aria-live="polite"
              >
                {balanceText}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={onSend}
            disabled={!canSubmit}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Send Privately'}
          </button>
        </div>
      )}

      {stealthResult && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            ) : (
              <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary"></span>
            )}
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {isSuccess ? 'Transfer Complete' : 'Pending'}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Stealth Address
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={stellarAddrUrl(stealthResult.stealthAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {stealthResult.stealthAddress}
                </a>
                <CopyButton text={stealthResult.stealthAddress} />
              </div>
            </div>

            {txHash && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Transaction Hash
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <a
                    href={stellarTxUrl(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-mono text-xs text-primary underline"
                  >
                    {txHash}
                  </a>
                  <CopyButton text={txHash} />
                </div>
              </div>
            )}
          </div>

          {isSuccess && (
            <button
              onClick={onReset}
              className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              New Transfer
            </button>
          )}
        </div>
      )}
    </section>
  );
}
