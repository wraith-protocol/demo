import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
  Memo,
} from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import { useTranslation } from 'react-i18next';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/telemetry';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import { STELLAR_ASSETS, getAssetByKey } from '@/lib/stellar/assets';
import { checkAssetTrustline } from '@/lib/stellar/buildSendStellarAsset';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_BASE_FEE_XLM = 0.00001;
const STELLAR_BASE_RESERVE_XLM = 1;

function getMinAmount(assetKey: StellarAssetKey): number {
  return assetKey === 'XLM' ? 0.0000001 : 0.0000001;
}

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

type HorizonAccount = {
  sequence: string;
  balances?: HorizonBalance[];
};

function formatAsset(value: number, assetKey: StellarAssetKey) {
  const assetInfo = getAssetByKey(assetKey);
  return value.toFixed(assetInfo.decimals).replace(/\.?0+$/, '');
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

function validateAmount(value: string, assetKey: StellarAssetKey) {
  if (!value) return 'Amount is required';
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) return `Enter a valid ${assetKey} amount`;

  const assetInfo = getAssetByKey(assetKey);
  const decimalPart = value.split('.')[1];
  if (decimalPart && decimalPart.length > assetInfo.decimals) {
    return `${assetKey} supports up to ${assetInfo.decimals} decimals`;
  }

  const parsed = Number(value);
  const minAmount = getMinAmount(assetKey);
  if (!Number.isFinite(parsed) || parsed <= minAmount) {
    return `Amount must be greater than ${minAmount} ${assetKey}`;
  }

  return '';
}

export function StellarSend() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const paramTo = searchParams.get('to');
  const paramAmount = searchParams.get('amount');
  const paramMemo = searchParams.get('memo');
  const paramExp = searchParams.get('exp');

  const { address, isConnected, signTransaction } = useStellarWallet();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);
  const [recipient, setRecipient] = useState(paramTo || '');
  const [amount, setAmount] = useState(paramAmount || '');
  const [assetKey, setAssetKey] = useState<StellarAssetKey>('XLM');
  const [memo, setMemo] = useState(paramMemo || '');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [isScanningQR, setIsScanningQR] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const closeScannerRef = useRef<HTMLButtonElement>(null);

  // Focus close button on mount and handle Escape key to close
  useEffect(() => {
    if (isScanningQR) {
      setScannerError('');
      if (closeScannerRef.current) {
        closeScannerRef.current.focus();
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsScanningQR(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isScanningQR]);

  const handleScanResult = useCallback((result: any, error: any) => {
    if (result) {
      const text = result.text?.trim();
      if (!text) return;

      // 1. Check if it's a payment link
      try {
        const url = new URL(text);
        const toParam = url.searchParams.get('to');
        if (toParam && toParam.startsWith('st:xlm:')) {
          setRecipient(toParam);
          const amtParam = url.searchParams.get('amount');
          if (amtParam) setAmount(amtParam);
          const memoParam = url.searchParams.get('memo');
          if (memoParam) setMemo(memoParam);
          setIsScanningQR(false);
          return;
        }
      } catch {
        // Not a URL, continue checking if it's a raw meta-address
      }

      // 2. Check if it's a raw meta-address
      if (text.startsWith('st:xlm:')) {
        setRecipient(text);
        setIsScanningQR(false);
      } else {
        setScannerError('Invalid QR code. Must be a stealth meta-address or payment link.');
      }
    }
  }, []);

  const scannerElement = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
    >
      <div className="w-full max-w-md border border-outline-variant bg-surface-container p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="scanner-modal-title"
            className="font-heading text-lg font-bold uppercase tracking-tight text-on-surface"
          >
            Scan Recipient QR
          </h2>
          <button
            ref={closeScannerRef}
            onClick={() => setIsScanningQR(false)}
            aria-label="Close scanner"
            className="text-outline hover:text-primary transition-colors focus:outline-none focus:ring-1 focus:ring-primary p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-center gap-4">
          <p className="text-xs text-on-surface-variant text-center">
            Point your camera at a stealth meta-address or payment link QR code.
          </p>

          <div className="relative w-full max-w-[280px] aspect-square overflow-hidden rounded-lg border border-outline-variant bg-black flex items-center justify-center">
            {isScanningQR && (
              <QrReader
                onResult={handleScanResult}
                constraints={{ facingMode: 'environment' }}
                containerStyle={{ width: '100%', height: '100%' }}
                videoStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            {/* Visual scan target overlay */}
            <div className="absolute inset-8 border-2 border-primary/40 pointer-events-none rounded border-dashed animate-pulse"></div>
          </div>

          {scannerError && (
            <p className="text-xs text-error text-center font-semibold bg-error/10 p-2 border border-error/20 w-full">
              {scannerError}
            </p>
          )}

          <button
            onClick={() => setIsScanningQR(false)}
            className="w-full mt-2 border border-outline-variant py-2.5 font-heading text-[11px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright focus:outline-none focus:ring-1 focus:ring-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
  const [sourceBalance, setSourceBalance] = useState<number | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [balanceLookupError, setBalanceLookupError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [retryStatus, setRetryStatus] = useState('');
  const [simulation, setSimulation] = useState<StellarSendSimulationState>(
    emptyStellarSendSimulation(),
  );

  useEffect(() => {
    if (paramExp) {
      const expSecs = parseInt(paramExp, 10);
      if (!isNaN(expSecs) && expSecs * 1000 < Date.now()) {
        setIsExpired(true);
        setError('This payment link has expired');
      }
    }
  }, [paramExp]);

  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const simulationTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const [trustlineMissing, setTrustlineMissing] = useState(false);
  const [trustlineCheckDone, setTrustlineCheckDone] = useState(false);

  const metaAddress = recipient.trim();
  const amountValue = amount.trim();

  const recipientError = useMemo(() => validateMetaAddress(metaAddress), [metaAddress]);
  const amountError = useMemo(() => validateAmount(amountValue, assetKey), [amountValue, assetKey]);
  const parsedAmount = amountError ? null : Number(amountValue);
  const requiredBalance =
    parsedAmount === null
      ? null
      : assetKey === 'XLM'
        ? parsedAmount + STELLAR_BASE_FEE_XLM + STELLAR_BASE_RESERVE_XLM
        : parsedAmount;
  const isAwaitingBalance =
    !!address && !amountError && !!amountValue && sourceBalance === null && !balanceLookupError;
  const balanceError =
    requiredBalance !== null && sourceBalance !== null && requiredBalance > sourceBalance
      ? `Insufficient ${assetKey} (you have ${formatAsset(sourceBalance, assetKey)}, need ${formatAsset(requiredBalance, assetKey)})`
      : '';
  const trustlineError =
    assetKey !== 'XLM' && trustlineCheckDone && trustlineMissing
      ? `Recipient lacks a ${assetKey} trustline. Ask them to add a trustline for ${assetKey}.`
      : '';
  const validationError = recipientError || amountError || balanceLookupError || balanceError || trustlineError;
  const canSubmit =
    !!address &&
    !!metaAddress &&
    !!amountValue &&
    !validationError &&
    !isAwaitingBalance &&
    !isBalanceLoading &&
    !isPending &&
    !isExpired;

  useEffect(() => {
    if (simulationTimeoutRef.current) {
      globalThis.clearTimeout(simulationTimeoutRef.current);
    }

    if (!address || !metaAddress || validationError || isPending || isExpired) {
      setSimulation(emptyStellarSendSimulation());
      return;
    }

    setSimulation({ status: 'loading', error: '', fee: null, returnValue: null, events: [] });

    simulationTimeoutRef.current = globalThis.setTimeout(async () => {
      try {
        const result = await simulateStellarSendAnnouncement(
          { address, recipient: metaAddress },
          { onRetry: (attempt, _, err) => {
              const msg = err instanceof Error ? err.message : '';
              setRetryStatus(`Retrying (${attempt}/3)…${msg ? ` (${msg})` : ''}`);
            },
          },
        );
        setRetryStatus('');
        setSimulation({
          status: 'success',
          error: '',
          fee: result.fee,
          returnValue: result.returnValue,
          events: result.events,
        });
      } catch (err) {
        setRetryStatus('');
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSimulation({
          status: 'error',
          error: err instanceof Error ? err.message : 'Simulation failed',
          fee: null,
          returnValue: null,
          events: [],
        });
      }
    }, 500);

    return () => {
      if (simulationTimeoutRef.current) {
        globalThis.clearTimeout(simulationTimeoutRef.current);
      }
    };
  }, [address, metaAddress, validationError, isPending, isExpired]);

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
        const accountRes = await fetchWithRetry(
          `${STELLAR_NETWORK.horizonUrl}/accounts/${address}`,
          { signal: controller.signal },
          {
            signal: controller.signal,
            onRetry: (attempt) => setRetryStatus(`Retrying (${attempt}/3)…`),
          },
        );
        setRetryStatus('');
        if (!accountRes.ok) throw new Error('Failed to load sender account');

        const accountData = (await accountRes.json()) as HorizonAccount;
        const assetInfo = getAssetByKey(assetKey);
        let parsedBalance: number;
        if (assetInfo.isNative) {
          const nativeBalance = accountData.balances?.find(
            (bal) => bal.asset_type === 'native',
          );
          parsedBalance = Number(nativeBalance?.balance);
        } else {
          const assetBalance = accountData.balances?.find(
            (bal) =>
              bal.asset_code === assetInfo.key &&
              bal.asset_issuer === (assetInfo.toAsset() as any).getIssuer(),
          );
          parsedBalance = Number(assetBalance?.balance || 0);
        }
        if (!Number.isFinite(parsedBalance)) throw new Error(`Failed to read ${assetKey} balance`);

        setSourceBalance(parsedBalance);
      } catch (err) {
        setRetryStatus('');
        if (!controller.signal.aborted) {
          setBalanceLookupError(
            err instanceof RetryExhaustedError
              ? err.message
              : err instanceof Error
                ? err.message
                : `Failed to check ${assetKey} balance`,
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsBalanceLoading(false);
        }
      }
    }, 500);

    return () => {
      controller.abort();
      globalThis.clearTimeout(timeout);
    };
  }, [address, amountError, amountValue, assetKey]);

  const assetInfo = getAssetByKey(assetKey);

  useEffect(() => {
    setTrustlineMissing(false);
    setTrustlineCheckDone(false);

    if (!metaAddress || !recipientError || assetKey === 'XLM') {
      if (assetKey === 'XLM') {
        setTrustlineCheckDone(true);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const decoded = decodeStealthMetaAddress(metaAddress);
        const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
        const hasTrustline = await checkAssetTrustline(result.stealthAddress, assetKey);
        if (!controller.signal.aborted) {
          setTrustlineMissing(!hasTrustline);
          setTrustlineCheckDone(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setTrustlineCheckDone(true);
        }
      }
    }, 800);

    return () => {
      controller.abort();
      globalThis.clearTimeout(timeout);
    };
  }, [metaAddress, assetKey, recipientError]);

  const handleSend = useCallback(async () => {
    setSubmitAttempted(true);
    setTouched({ recipient: true, amount: true });

    if (!address) {
      setError(t('common.walletNotConnected'));
      return;
    }

    if (!canSubmit) {
      setError(validationError || 'Enter valid send details');
      return;
    }

    setError('');
    setIsPending(true);
    setRetryStatus('');
    let txHashHex = '';

    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const metaAddress = recipient;
      if (!metaAddress.startsWith('st:xlm:')) {
        setError(t('stellar.validMetaAddressError'));
        setIsPending(false);
        return;
      }

      const decoded = decodeStealthMetaAddress(metaAddress);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);
      trackEvent('send_submitted');

      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;
      const sendAsset = assetInfo.toAsset();

      const accountRes = await fetchWithRetry(`${horizonUrl}/accounts/${address}`, {}, { onRetry });
      setRetryStatus('');
      if (!accountRes.ok) throw new Error('Failed to load sender account');
      const accountData = (await accountRes.json()) as HorizonAccount;
      const sourceAccount = new Account(address, accountData.sequence);

      let stealthExists = false;
      try {
        const stealthCheckRes = await fetchWithRetry(
          `${horizonUrl}/accounts/${result.stealthAddress}`,
          {},
          { onRetry },
        );
        stealthExists = stealthCheckRes.ok;
      } catch {
        // Transient network error on existence check — assume not created yet
      } finally {
        setRetryStatus('');
      }

      let builder = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase });

      if (stealthExists) {
        builder = builder.addOperation(
          Operation.payment({
            destination: result.stealthAddress,
            asset: sendAsset,
            amount: amountValue,
          }),
        );
      } else if (assetInfo.isNative) {
        builder = builder.addOperation(
          Operation.createAccount({
            destination: result.stealthAddress,
            startingBalance: amountValue,
          }),
        );
      } else {
        builder = builder.addOperation(
          Operation.payment({
            destination: result.stealthAddress,
            asset: sendAsset,
            amount: amountValue,
          }),
        );
      }

      builder = builder.setTimeout(30);

      if (memo) {
        builder = builder.addMemo(Memo.text(memo));
      }

      const classicTx = builder.build();

      const signedXdr = await signTransaction(classicTx.toXDR());
      txHashHex = classicTx.hash().toString('hex');
      setTxHash(txHashHex);

      addActivity({
        id: txHashHex,
        chain: 'stellar',
        wallet: address,
        kind: 'stealth-send',
        direction: 'out',
        status: 'pending',
        amount: amountValue,
        recipient: metaAddress,
        timestamp: Date.now(),
      });

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedXdr)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction ||
            submitData.title ||
            t('common.transactionFailed'),
        );
      }

      setTxHash(submitData.hash);

      // Announce via Soroban (best-effort)
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban =
          (window as any).sorobanServerMock || new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
        const announcerContract = new Contract(ANNOUNCER_CONTRACT);

        const freshRes = await fetchWithRetry(`${horizonUrl}/accounts/${address}`, {}, { onRetry });
        setRetryStatus('');
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

        const simulated = await withRetry(() => soroban.simulateTransaction(announceTx), { onRetry });
        setRetryStatus('');
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
      } finally {
        setRetryStatus('');
      }

      setIsSuccess(true);
      updateActivity(txHashHex, 'confirmed');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      setIsPending(false);
    }
  }, [address, recipient, amount, signTransaction, t]);
      setRetryStatus('');
      if (txHashHex) updateActivity(txHashHex, 'failed');
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [address, amountValue, canSubmit, metaAddress, memo, signTransaction, validationError]);

  const reset = () => {
    setRecipient(paramTo || '');
    setAmount(paramAmount || '');
    setMemo(paramMemo || '');
    setStealthResult(null);
    setTxHash(null);
    setIsSuccess(false);
    if (!isExpired) {
      setError('');
    }
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
          {t('stellar.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('stellar.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('stellar.sendConnectPrompt')}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('stellar.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('stellar.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('stellar.sendDescription')}
        </p>
      </div>

      {!stealthResult && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.recipientMetaAddress')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={t('stellar.recipientPlaceholder')}
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                {t('common.paste')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.amount')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                XLM
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.networkFee')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('stellar.networkFeeAmount')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.announcerContract')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('stellar.announcerContractName')}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? t('common.confirmInWallet') : t('common.sendPrivately')}
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
              {isSuccess ? t('common.transferComplete') : t('common.pending')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.stealthAddress')}
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
                  {t('common.transactionHash')}
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
              {t('common.newTransfer')}
            </button>
          )}
        </div>
      )}
    </section>
  const balanceText =
    isBalanceLoading || isAwaitingBalance
      ? 'Checking...'
      : balanceLookupError ||
        balanceError ||
        (sourceBalance !== null ? `${formatAsset(sourceBalance, assetKey)} ${assetKey}` : 'Enter amount');

  return (
    <>
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stellar Testnet / {assetKey}
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Send
          </h1>
          <p className="font-body text-sm leading-relaxed text-on-surface-variant">
            Send {assetKey} privately using stealth addresses. The recipient gets funds at a fresh address
            only they can control.
          </p>
      </div>

      {!stealthResult && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="recipient-meta-address"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Recipient Meta-Address
            </label>
            <div className="relative">
              <input
                id="recipient-meta-address"
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
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
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="asset-select"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Asset
            </label>
            <select
              id="asset-select"
              value={assetKey}
              onChange={(e) => setAssetKey(e.target.value as StellarAssetKey)}
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            >
              {STELLAR_ASSETS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="amount"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              Amount
            </label>
            <div className="relative">
              <input
                id="amount"
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                {assetKey}
              </span>
            </div>
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
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          {trustlineError && (
            <div className="border border-error/20 bg-error/5 p-3">
              <p className="font-mono text-xs text-error">{trustlineError}</p>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                To add a{' '}
                <a
                  href="https://stellar.org/learn/how-to-add-trustline"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  trustline
                </a>
                , the recipient needs to set a trustline for {assetKey} on their Stellar account.
              </p>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : `Send ${assetKey}`}
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
            <span className="font-mono text-[10px] text-outline">{assetKey}</span>
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
    <StellarSendView
      isConnected={isConnected}
      recipient={recipient}
      amount={amount}
      assetKey={assetKey}
      recipientError={recipientError}
      showRecipientError={touched.recipient || submitAttempted}
      amountError={amountError}
      showAmountError={touched.amount || submitAttempted}
      amountInvalid={!!(amountError || balanceLookupError || balanceError)}
      balanceText={balanceText}
      balanceIsError={!!(balanceLookupError || balanceError)}
      trustlineError={trustlineError}
      simulationStatus={simulation.status}
      simulationError={simulation.status === 'error' ? simulation.error : ''}
      simulationFee={simulation.status === 'success' ? simulation.fee : null}
      simulationReturnValue={simulation.status === 'success' ? simulation.returnValue : null}
      simulationEvents={simulation.status === 'success' ? simulation.events : []}
      error={error}
      retryStatus={retryStatus}
      canSubmit={canSubmit && simulation.status === 'success'}
      isPending={isPending}
      stealthResult={stealthResult}
      txHash={txHash}
      isSuccess={isSuccess}
      onRecipientChange={setRecipient}
      onRecipientBlur={() => setTouched((prev) => ({ ...prev, recipient: true }))}
      onAssetChange={setAssetKey}
      onAmountChange={setAmount}
      onAmountBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
      onPaste={handlePaste}
      onSend={handleSend}
      onReset={reset}
      memo={memo}
      onMemoChange={setMemo}
      isExpired={isExpired}
      paramTo={!!paramTo}
      paramAmount={!!paramAmount}
      paramMemo={!!paramMemo}
      onScanQRClick={() => setIsScanningQR(true)}
      isScanningQR={isScanningQR}
      scannerElement={scannerElement}
    />
  </>
  );
}
