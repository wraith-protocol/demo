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
import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';
import { StellarSendView } from '@/components/StellarSendView';
import { useActivityStore } from '@/stores/activityStore';
import {
  emptyStellarSendSimulation,
  simulateStellarSendAnnouncement,
  type StellarSendSimulationState,
} from '@/lib/stellarSimulation';
import { fetchWithRetry, withRetry, RetryExhaustedError } from '@/lib/stellar/retry';

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
  const [memo, setMemo] = useState(paramMemo || '');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);
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
        const nativeBalance = accountData.balances?.find((bal) => bal.asset_type === 'native');
        const parsedBalance = Number(nativeBalance?.balance);
        if (!Number.isFinite(parsedBalance)) throw new Error('Failed to read XLM balance');

        setSourceBalance(parsedBalance);
      } catch (err) {
        setRetryStatus('');
        if (!controller.signal.aborted) {
          setBalanceLookupError(
            err instanceof RetryExhaustedError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Failed to check XLM balance',
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
    setRetryStatus('');
    let txHashHex = '';

    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const decoded = decodeStealthMetaAddress(metaAddress);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);

      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

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
            asset: Asset.native(),
            amount: amountValue,
          }),
        );
      } else {
        builder = builder.addOperation(
          Operation.createAccount({
            destination: result.stealthAddress,
            startingBalance: amountValue,
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
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      setTxHash(submitData.hash);

      // Announce via Soroban (best-effort)
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban = new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
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

  const balanceText =
    isBalanceLoading || isAwaitingBalance
      ? 'Checking...'
      : balanceLookupError ||
        balanceError ||
        (sourceBalance !== null ? `${formatXlm(sourceBalance)} XLM` : 'Enter amount');

  return (
    <StellarSendView
      isConnected={isConnected}
      recipient={recipient}
      amount={amount}
      recipientError={recipientError}
      showRecipientError={touched.recipient || submitAttempted}
      amountError={amountError}
      showAmountError={touched.amount || submitAttempted}
      amountInvalid={!!(amountError || balanceLookupError || balanceError)}
      balanceText={balanceText}
      balanceIsError={!!(balanceLookupError || balanceError)}
      simulationStatus={simulation.status}
      simulationError={simulation.status === 'error' ? simulation.error : ''}
      simulationFee={simulation.status === 'success' ? simulation.fee : null}
      simulationReturnValue={
        simulation.status === 'success' ? simulation.returnValue : null
      }
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
    />
  );
}
