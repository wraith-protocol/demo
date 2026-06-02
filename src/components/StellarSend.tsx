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
  resolveName,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';
import { StellarSendView } from '@/components/StellarSendView';

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
  const [resolvedMetaAddress, setResolvedMetaAddress] = useState<string | null>(null);
  const [isResolvingName, setIsResolvingName] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isMetaAddress = recipient.startsWith('st:xlm:');
  const cleanedName = recipient.replace(/\.wraith$/i, '').toLowerCase();
  const isWraithName = !isMetaAddress && cleanedName.length >= 3 && cleanedName.length <= 32 && /^[a-z0-9]+$/.test(cleanedName);

  useEffect(() => {
    if (resolveTimeoutRef.current) {
      clearTimeout(resolveTimeoutRef.current);
    }

    if (!isWraithName) {
      setResolvedMetaAddress(null);
      setResolveError(null);
      return;
    }

    setIsResolvingName(true);
    setResolveError(null);

    resolveTimeoutRef.current = setTimeout(async () => {
      try {
        const metaAddress = await resolveName(cleanedName);
        if (metaAddress === null) {
          setResolveError('Name not registered on Stellar testnet');
          setResolvedMetaAddress(null);
        } else {
          setResolvedMetaAddress(metaAddress);
          setResolveError(null);
        }
      } catch (err) {
        setResolveError('Failed to resolve name');
        setResolvedMetaAddress(null);
      } finally {
        setIsResolvingName(false);
      }
    }, 300);

    return () => {
      if (resolveTimeoutRef.current) {
        clearTimeout(resolveTimeoutRef.current);
      }
    };
  }, [isWraithName, cleanedName]);

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
      error={error}
      canSubmit={canSubmit}
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
    />
  );
}
