import { useTransactionState } from '@/hooks/useTransactionState';
import { transactionBlockReason } from '@/lib/transactionActivity';
import { useCallback, useEffect, useState } from 'react';
import { Account, Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  signStellarTransaction,
  type MatchedAnnouncement,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useActivityStore } from '@/stores/activityStore';
import { trackEvent } from '@/lib/telemetry';
import { STELLAR_NETWORK } from '@/config';
import { fetchWithRetry, RetryExhaustedError } from '@/lib/stellar/retry';
import { getAssetByKey, parseAssetBalances, type StellarAssetKey } from '@/lib/stellar/assets';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface HorizonBalance {
  asset_type: string;
  balance: string;
}

interface HorizonAccount {
  sequence: string;
  balances?: HorizonBalance[];
  subentry_count?: number;
}

function parseHorizonAccount(value: unknown): HorizonAccount | null {
  if (!isRecord(value) || typeof value.sequence !== 'string') return null;

  const balances: HorizonBalance[] = [];
  if (Array.isArray(value.balances)) {
    for (const entry of value.balances) {
      if (
        isRecord(entry) &&
        typeof entry.asset_type === 'string' &&
        typeof entry.balance === 'string'
      ) {
        balances.push({ asset_type: entry.asset_type, balance: entry.balance });
      }
    }
  }

  return {
    sequence: value.sequence,
    ...(balances.length > 0 ? { balances } : {}),
    ...(typeof value.subentry_count === 'number' ? { subentry_count: value.subentry_count } : {}),
  };
}

function submitErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const extras = isRecord(value.extras) ? value.extras : undefined;
  const resultCodes = extras && isRecord(extras.result_codes) ? extras.result_codes : undefined;
  if (resultCodes && typeof resultCodes.transaction === 'string') return resultCodes.transaction;
  if (typeof value.title === 'string') return value.title;
  return fallback;
}

interface UseStellarWithdrawalOptions {
  match: MatchedAnnouncement;
  onBalanceFetched: (address: string, balance: string) => void;
  onWithdrawn: () => void;
}

export interface StellarWithdrawalState {
  balances: Record<string, string>;
  balanceState: 'loading' | 'loaded' | 'error';
  withdrawAssetKey: StellarAssetKey;
  dest: string;
  withdrawing: boolean;
  withdrawHash: string | null;
  feeBumpHash: string | null;
  error: string;
  retryStatus: string;
  showKey: boolean;
  showSponsorPrompt: boolean;
  showNetworkModal: boolean;
  setDest: (value: string) => void;
  setWithdrawAssetKey: (value: StellarAssetKey) => void;
  setShowKey: (value: boolean) => void;
  setShowNetworkModal: (value: boolean) => void;
  cancelSponsor: () => void;
  withdraw: () => Promise<void>;
  sponsoredWithdraw: () => Promise<void>;
}

export function useStellarWithdrawal({
  match,
  onBalanceFetched,
  onWithdrawn,
}: UseStellarWithdrawalOptions): StellarWithdrawalState {
  const { address, signTransaction, isNetworkMismatch } = useStellarWallet();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);

  const [balances, setBalances] = useState<Record<string, string>>({});
  const [balanceState, setBalanceState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [withdrawAssetKey, setWithdrawAssetKey] = useState<StellarAssetKey>('XLM');
  const [dest, setDest] = useState('');
  const [withdrawing, setWithdrawing] = useTransactionState<boolean>(false, Boolean);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [feeBumpHash, setFeeBumpHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retryStatus, setRetryStatus] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSponsorPrompt, setShowSponsorPrompt] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetchWithRetry(
          `${STELLAR_NETWORK.horizonUrl}/accounts/${match.stealthAddress}`,
          {},
          { onRetry: (attempt) => setRetryStatus(`Retrying (${attempt}/3)…`) },
        );
        setRetryStatus('');
        if (!response.ok) {
          if (active) setBalances({ XLM: '0' });
          return;
        }
        const parsed = parseHorizonAccount(await response.json());
        if (active) setBalances(parsed ? parseAssetBalances(parsed.balances ?? []) : { XLM: '0' });
      } catch {
        setRetryStatus('');
        if (active) setBalances({ XLM: '0' });
      } finally {
        if (active) setBalanceState('loaded');
      }
    })();
    return () => {
      active = false;
    };
  }, [match.stealthAddress]);

  useEffect(() => {
    const balance = balances.XLM;
    if (balance !== undefined) onBalanceFetched(match.stealthAddress, balance);
  }, [balances, match.stealthAddress, onBalanceFetched]);

  const rejectMismatch = useCallback(() => {
    if (!isNetworkMismatch) return false;
    setShowNetworkModal(true);
    return true;
  }, [isNetworkMismatch]);

  const withdraw = useCallback(async () => {
    const blocked = transactionBlockReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!dest) return;
    if (rejectMismatch()) return;

    setError('');
    setRetryStatus('');
    setWithdrawing(true);
    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const response = await fetchWithRetry(
        `${STELLAR_NETWORK.horizonUrl}/accounts/${match.stealthAddress}`,
        {},
        { onRetry },
      );
      setRetryStatus('');
      if (!response.ok) throw new Error('Account not found');
      const account = parseHorizonAccount(await response.json());
      if (!account) throw new Error('Invalid account response');

      const sourceAccount = new Account(match.stealthAddress, account.sequence);
      const assetInfo = getAssetByKey(withdrawAssetKey);
      const balance = balances[withdrawAssetKey];
      const amount = balance === undefined ? 0 : parseFloat(balance);
      if (amount <= 0) throw new Error(`No ${withdrawAssetKey} balance`);

      let paymentAmount: string;
      let asset: Asset;
      if (withdrawAssetKey === 'XLM') {
        const native = account.balances?.find((entry) => entry.asset_type === 'native');
        const currentBalance = native ? parseFloat(native.balance) : 0;
        if (!native || currentBalance === 0) throw new Error('No XLM balance');

        const baseReserve = 0.5;
        const minReserve = (2 + (account.subentry_count ?? 0)) * baseReserve;
        if (currentBalance < minReserve + 0.00011) {
          if (!address) throw new Error('Sponsored withdrawal requires connected wallet');
          setShowSponsorPrompt(true);
          return;
        }

        paymentAmount = (currentBalance - minReserve - 0.00001).toFixed(7);
        if (parseFloat(paymentAmount) <= 0) throw new Error('Balance too low to cover reserve');
        asset = Asset.native();
      } else {
        paymentAmount = amount.toFixed(assetInfo.decimals);
        asset = assetInfo.toAsset();
      }

      const tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      })
        .addOperation(Operation.payment({ destination: dest, asset, amount: paymentAmount }))
        .setTimeout(30)
        .build();

      const txHash = tx.hash();
      const signature = signStellarTransaction(
        txHash,
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );
      tx.addSignature(match.stealthAddress, Buffer.from(signature).toString('base64'));

      const txHashHex = Buffer.from(txHash).toString('hex');
      addActivity({
        id: txHashHex,
        chain: 'stellar',
        wallet: address ?? '',
        kind: 'withdrawal',
        direction: 'out',
        status: 'pending',
        amount: paymentAmount,
        recipient: dest,
        timestamp: Date.now(),
      });

      const submit = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(tx.toXDR())}`,
      });
      const submitPayload: unknown = await submit.json();
      if (!submit.ok) throw new Error(submitErrorMessage(submitPayload, 'Transaction failed'));

      const hash =
        isRecord(submitPayload) && typeof submitPayload.hash === 'string'
          ? submitPayload.hash
          : txHashHex;
      setWithdrawHash(hash);
      updateActivity(txHashHex, 'confirmed');
      trackEvent('withdraw');
      onWithdrawn();
    } catch (err) {
      setError(
        err instanceof RetryExhaustedError || err instanceof Error
          ? err.message
          : 'Withdraw failed',
      );
    } finally {
      setWithdrawing(false);
    }
  }, [
    address,
    balances,
    dest,
    match,
    onWithdrawn,
    rejectMismatch,
    updateActivity,
    addActivity,
    withdrawAssetKey,
  ]);

  const sponsoredWithdraw = useCallback(async () => {
    const blocked = transactionBlockReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!dest || !address) return;
    if (rejectMismatch()) return;

    setError('');
    setRetryStatus('');
    setWithdrawing(true);
    setShowSponsorPrompt(false);
    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const response = await fetchWithRetry(
        `${STELLAR_NETWORK.horizonUrl}/accounts/${match.stealthAddress}`,
        {},
        { onRetry },
      );
      setRetryStatus('');
      if (!response.ok) throw new Error('Stealth account not found');
      const account = parseHorizonAccount(await response.json());
      if (!account) throw new Error('Invalid account response');

      const innerTx = new TransactionBuilder(new Account(match.stealthAddress, account.sequence), {
        fee: '0',
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      })
        .addOperation(Operation.accountMerge({ destination: dest }))
        .setTimeout(30)
        .build();

      const signature = signStellarTransaction(
        innerTx.hash(),
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );
      innerTx.addSignature(match.stealthAddress, Buffer.from(signature).toString('base64'));

      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        address,
        '1000',
        innerTx,
        STELLAR_NETWORK.networkPassphrase,
      );
      const signedXdr = await signTransaction(feeBumpTx.toXDR());
      const txHashHex = Buffer.from(feeBumpTx.hash()).toString('hex');

      addActivity({
        id: txHashHex,
        chain: 'stellar',
        wallet: address,
        kind: 'withdrawal',
        direction: 'out',
        status: 'pending',
        recipient: dest,
        timestamp: Date.now(),
      });

      const submit = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedXdr)}`,
      });
      const submitPayload: unknown = await submit.json();
      if (!submit.ok) throw new Error(submitErrorMessage(submitPayload, 'Transaction failed'));

      const hash =
        isRecord(submitPayload) && typeof submitPayload.hash === 'string'
          ? submitPayload.hash
          : txHashHex;
      setFeeBumpHash(hash);
      setWithdrawHash(hash);
      updateActivity(txHashHex, 'confirmed');
      trackEvent('withdraw');
      onWithdrawn();
    } catch (err) {
      setRetryStatus('');
      setError(err instanceof Error ? err.message : 'Sponsored withdraw failed');
    } finally {
      setWithdrawing(false);
    }
  }, [
    address,
    dest,
    match,
    onWithdrawn,
    rejectMismatch,
    signTransaction,
    addActivity,
    updateActivity,
  ]);

  const cancelSponsor = useCallback(() => setShowSponsorPrompt(false), []);

  return {
    balances,
    balanceState,
    withdrawAssetKey,
    dest,
    withdrawing,
    withdrawHash,
    feeBumpHash,
    error,
    retryStatus,
    showKey,
    showSponsorPrompt,
    showNetworkModal,
    setDest,
    setWithdrawAssetKey,
    setShowKey,
    setShowNetworkModal,
    cancelSponsor,
    withdraw,
    sponsoredWithdraw,
  };
}
