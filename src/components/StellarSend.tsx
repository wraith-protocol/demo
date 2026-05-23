import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_BASE_FEE_XLM = 0.00001;
const STELLAR_BASE_RESERVE_XLM = 1;
const MIN_XLM_AMOUNT = 0.0000001;

type HorizonBalance = {
  asset_type: string;
  balance: string;
};

type HorizonAccount = {
  sequence: string;
  balances?: HorizonBalance[];
};

function formatXlm(value: number) {
  return value.toFixed(7).replace(/\.?0+$/, '');
}

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

export function StellarSend() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [sourceBalance, setSourceBalance] = useState<number | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [balanceLookupError, setBalanceLookupError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const metaAddress = recipient.trim();
  const amountValue = amount.trim();

  const recipientError = useMemo(() => validateMetaAddress(metaAddress), [metaAddress]);
  const amountError = useMemo(() => validateAmount(amountValue), [amountValue]);
  const parsedAmount = amountError ? null : Number(amountValue);
  const requiredBalance =
    parsedAmount === null ? null : parsedAmount + STELLAR_BASE_FEE_XLM + STELLAR_BASE_RESERVE_XLM;
  const isAwaitingBalance =
    !!address && !amountError && !!amountValue && sourceBalance === null && !balanceLookupError;
  const balanceError =
    requiredBalance !== null && sourceBalance !== null && requiredBalance > sourceBalance
      ? `Insufficient XLM (you have ${formatXlm(sourceBalance)}, need ${formatXlm(requiredBalance)})`
      : '';
  const validationError = recipientError || amountError || balanceLookupError || balanceError;
  const canSubmit =
    !!address &&
    !!metaAddress &&
    !!amountValue &&
    !validationError &&
    !isAwaitingBalance &&
    !isBalanceLoading &&
    !isPending;

  useEffect(() => {
    setSourceBalance(null);
    setBalanceLookupError('');

    if (!address || amountError || !amountValue) {
      setIsBalanceLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsBalanceLoading(true);

      try {
        const accountRes = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`, {
          signal: controller.signal,
        });
        if (!accountRes.ok) throw new Error('Failed to load sender account');

        const accountData = (await accountRes.json()) as HorizonAccount;
        const nativeBalance = accountData.balances?.find((bal) => bal.asset_type === 'native');
        const parsedBalance = Number(nativeBalance?.balance);
        if (!Number.isFinite(parsedBalance)) throw new Error('Failed to read XLM balance');

        setSourceBalance(parsedBalance);
      } catch (err) {
        if (!controller.signal.aborted) {
          setBalanceLookupError(err instanceof Error ? err.message : 'Failed to check XLM balance');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsBalanceLoading(false);
        }
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [address, amountError, amountValue]);

  const handleSend = useCallback(async () => {
    setSubmitAttempted(true);
    setTouched({ recipient: true, amount: true });

    if (!address) {
      setError('Wallet not connected');
      return;
    }

    if (!canSubmit) {
      setError(validationError || 'Enter valid send details');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const decoded = decodeStealthMetaAddress(metaAddress);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);

      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const accountRes = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!accountRes.ok) throw new Error('Failed to load sender account');
      const accountData = (await accountRes.json()) as HorizonAccount;
      const sourceAccount = new Account(address, accountData.sequence);

      const stealthExists = await fetch(`${horizonUrl}/accounts/${result.stealthAddress}`).then(
        (r) => r.ok,
      );

      let classicTx;
      if (stealthExists) {
        classicTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.payment({
              destination: result.stealthAddress,
              asset: Asset.native(),
              amount: amountValue,
            }),
          )
          .setTimeout(30)
          .build();
      } else {
        classicTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.createAccount({
              destination: result.stealthAddress,
              startingBalance: amountValue,
            }),
          )
          .setTimeout(30)
          .build();
      }

      const signedXdr = await signTransaction(classicTx.toXDR());

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedXdr)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      setTxHash(submitData.hash);

      // Announce via Soroban (best-effort)
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban = new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
        const announcerContract = new Contract(ANNOUNCER_CONTRACT);

        const freshRes = await fetch(`${horizonUrl}/accounts/${address}`);
        const freshData = await freshRes.json();
        const freshAccount = new Account(address, freshData.sequence);

        const announceTx = new TransactionBuilder(freshAccount, { fee: '100', networkPassphrase })
          .addOperation(
            announcerContract.call(
              'announce',
              nativeToScVal(SCHEME_ID, { type: 'u32' }),
              new Address(result.stealthAddress).toScVal(),
              xdr.ScVal.scvBytes(Buffer.from(result.ephemeralPubKey)),
              xdr.ScVal.scvBytes(Buffer.from([result.viewTag])),
            ),
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(announceTx);
        if (!('error' in simulated)) {
          const assembled = rpcMod
            .assembleTransaction(
              announceTx,
              simulated as Parameters<typeof rpcMod.assembleTransaction>[1],
            )
            .build();

          const signedAnnounce = await signTransaction(assembled.toXDR());
          await soroban.sendTransaction(
            TransactionBuilder.fromXDR(signedAnnounce, networkPassphrase),
          );
        }
      } catch {
        // Announcement is best-effort — payment already succeeded
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [address, amountValue, canSubmit, metaAddress, signTransaction, validationError]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setTxHash(null);
    setIsSuccess(false);
    setError('');
    setTouched({ recipient: false, amount: false });
    setSubmitAttempted(false);
    setSourceBalance(null);
    setBalanceLookupError('');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRecipient(text);
      setTouched((prev) => ({ ...prev, recipient: true }));
    } catch {
      // Clipboard access denied
    }
  };

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
                onChange={(e) => setRecipient(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, recipient: true }))}
                aria-invalid={!!recipientError}
                aria-describedby="stellar-recipient-error"
                placeholder="st:xlm:..."
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
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
              {(touched.recipient || submitAttempted) && recipientError ? recipientError : ' '}
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
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
                aria-invalid={!!(amountError || balanceLookupError || balanceError)}
                aria-describedby="stellar-amount-error stellar-balance-error"
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                XLM
              </span>
            </div>
            <p id="stellar-amount-error" className="min-h-5 text-xs text-error" aria-live="polite">
              {(touched.amount || submitAttempted) && amountError ? amountError : ' '}
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
                  balanceLookupError || balanceError ? 'text-error' : 'text-on-surface-variant'
                }`}
                aria-live="polite"
              >
                {isBalanceLoading || isAwaitingBalance
                  ? 'Checking...'
                  : balanceLookupError ||
                    balanceError ||
                    (sourceBalance !== null ? `${formatXlm(sourceBalance)} XLM` : 'Enter amount')}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
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
              onClick={reset}
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
