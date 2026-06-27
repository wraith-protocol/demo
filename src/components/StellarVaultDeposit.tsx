import { useState, useCallback, useMemo } from 'react';
import {
  decodeStealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { CopyButton } from '@/components/CopyButton';

const MIN_XLM_AMOUNT = 0.0000001;

type DepositState = 'idle' | 'pending' | 'success';

function validateMetaAddress(value: string) {
  if (!value) return 'Recipient meta-address is required';
  if (!value.startsWith('st:xlm:')) return 'Not a valid Stellar stealth meta-address';

  try {
    decodeStealthMetaAddress(value);
    return '';
  } catch {
    return 'Not a valid Stellar stealth meta-address';
  }
}

function validateAmount(value: string) {
  if (!value) return 'Amount is required';
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) return 'Enter a valid XLM amount';

  const decimalPart = value.split('.')[1];
  if (decimalPart && decimalPart.length > 7) return 'XLM supports up to 7 decimals';

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= MIN_XLM_AMOUNT) {
    return 'Amount must be greater than 0.0000001 XLM';
  }

  return '';
}

function validateUnlockLedger(value: string) {
  if (!value) return 'Unlock ledger is required';
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 'Unlock ledger must be a positive integer';
  }
  return '';
}

function validateRefundWindow(value: string) {
  if (!value) return 'Refund window is required';
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 'Refund window must be a positive integer (ledgers)';
  }
  return '';
}

export function StellarVaultDeposit() {
  const { address, signTransaction } = useStellarWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [unlockLedger, setUnlockLedger] = useState('');
  const [refundWindow, setRefundWindow] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({
    recipient: false,
    amount: false,
    unlockLedger: false,
    refundWindow: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [depositState, setDepositState] = useState<DepositState>('idle');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const metaAddress = recipient.trim();
  const amountValue = amount.trim();
  const unlockLedgerValue = unlockLedger.trim();
  const refundWindowValue = refundWindow.trim();

  const recipientError = useMemo(() => validateMetaAddress(metaAddress), [metaAddress]);
  const amountError = useMemo(() => validateAmount(amountValue), [amountValue]);
  const unlockLedgerError = useMemo(() => validateUnlockLedger(unlockLedgerValue), [unlockLedgerValue]);
  const refundWindowError = useMemo(() => validateRefundWindow(refundWindowValue), [refundWindowValue]);

  const validationError = recipientError || amountError || unlockLedgerError || refundWindowError;
  const canSubmit =
    !!address &&
    !!metaAddress &&
    !!amountValue &&
    !!unlockLedgerValue &&
    !!refundWindowValue &&
    !validationError &&
    depositState !== 'pending';

  const handleDeposit = useCallback(async () => {
    setSubmitAttempted(true);
    setTouched({ recipient: true, amount: true, unlockLedger: true, refundWindow: true });

    if (!address) {
      setError('Wallet not connected');
      return;
    }

    if (!canSubmit) {
      setError(validationError || 'Enter valid deposit details');
      return;
    }

    setError('');
    setDepositState('pending');

    try {
      // TODO: Integrate with stealth-vault contract when available
      // For now, simulate the deposit flow
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate deposit ID and transaction hash
      const simulatedDepositId = `vault_${Date.now()}`;
      const simulatedTxHash = `${simulatedDepositId}_tx`;

      setDepositId(simulatedDepositId);
      setTxHash(simulatedTxHash);
      setDepositState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deposit failed');
      setDepositState('idle');
    }
  }, [address, metaAddress, amountValue, unlockLedgerValue, refundWindowValue, canSubmit, validationError]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setUnlockLedger('');
    setRefundWindow('');
    setDepositId(null);
    setTxHash(null);
    setDepositState('idle');
    setError('');
    setTouched({ recipient: false, amount: false, unlockLedger: false, refundWindow: false });
    setSubmitAttempted(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {depositState === 'idle' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Recipient Meta-Address
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, recipient: true }))}
              aria-invalid={!!recipientError}
              aria-describedby="vault-recipient-error"
              placeholder="st:xlm:..."
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
            <p
              id="vault-recipient-error"
              className="min-h-5 text-xs text-error"
              aria-live="polite"
            >
              {(touched.recipient || submitAttempted) && recipientError ? recipientError : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
                aria-invalid={!!amountError}
                aria-describedby="vault-amount-error"
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                XLM
              </span>
            </div>
            <p id="vault-amount-error" className="min-h-5 text-xs text-error" aria-live="polite">
              {(touched.amount || submitAttempted) && amountError ? amountError : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Unlock Ledger
            </label>
            <input
              type="text"
              value={unlockLedger}
              onChange={(e) => setUnlockLedger(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, unlockLedger: true }))}
              aria-invalid={!!unlockLedgerError}
              aria-describedby="vault-unlock-error"
              placeholder="e.g., 100000"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
            <p
              id="vault-unlock-error"
              className="min-h-5 text-xs text-error"
              aria-live="polite"
            >
              {(touched.unlockLedger || submitAttempted) && unlockLedgerError
                ? unlockLedgerError
                : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Refund Window (ledgers)
            </label>
            <input
              type="text"
              value={refundWindow}
              onChange={(e) => setRefundWindow(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, refundWindow: true }))}
              aria-invalid={!!refundWindowError}
              aria-describedby="vault-refund-error"
              placeholder="e.g., 10000"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
            <p
              id="vault-refund-error"
              className="min-h-5 text-xs text-error"
              aria-live="polite"
            >
              {(touched.refundWindow || submitAttempted) && refundWindowError
                ? refundWindowError
                : ' '}
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Contract
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                Stealth Vault (Coming Soon)
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleDeposit}
            disabled={!canSubmit}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {depositState === 'pending' ? 'Creating deposit...' : 'Create Deposit'}
          </button>
        </>
      )}

      {depositState === 'success' && depositId && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              Deposit Created
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Deposit ID
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-xs text-primary">{depositId}</span>
                <CopyButton text={depositId} />
              </div>
            </div>

            {txHash && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Transaction Hash
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-xs text-primary">{txHash}</span>
                  <CopyButton text={txHash} />
                </div>
              </div>
            )}

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Amount
              </span>
              <div className="mt-0.5 font-mono text-xs text-on-surface">
                {amountValue} XLM
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Unlock Ledger
              </span>
              <div className="mt-0.5 font-mono text-xs text-on-surface">
                {unlockLedgerValue}
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Refund Window
              </span>
              <div className="mt-0.5 font-mono text-xs text-on-surface">
                {refundWindowValue} ledgers after unlock
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            New Deposit
          </button>
        </div>
      )}
    </div>
  );
}
