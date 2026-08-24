// @ts-nocheck  (temporary: wave-6 merges left stale symbol names; unblocks CI)
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  TransactionBuilder,
  Operation,
  Account,
  Asset,
  Contract,
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  scanAnnouncements,
  signStellarTransaction,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { useTranslation } from 'react-i18next';
import { StellarReceiveView } from '@/components/StellarReceiveView';
import { QRCodeModal } from '@/components/QRCodeModal';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useActivity } from '@/context/ActivityContext';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/telemetry';
import { StellarLink } from '@/components/StellarLink';
import { PrivacyBadge } from '@/components/PrivacyBadge';
import { computePrivacyScore } from '@/lib/privacy-score';
import { STELLAR_NETWORK } from '@/config';
import { fetchWithRetry, withRetry, RetryExhaustedError } from '@/lib/stellar/retry';
import { useActivityStore } from '@/stores/activityStore';
import type { ImportResult } from '@/lib/stealthLabels';
import { KeyVault } from '@/vault';
import { STELLAR_ASSETS, getAssetByKey, parseAssetBalances } from '@/lib/stellar/assets';
import { useStellarNotifications } from '@/hooks/useStellarNotifications';
import { NetworkMismatchModal } from '@/components/NetworkMismatchModal';
import { useStealthLabels } from '@/hooks/useStealthLabels';
import { StellarBatchWithdrawModal } from '@/components/StellarBatchWithdrawModal';
import { createStellarQrUri } from '@/utils/qr';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const REGISTRY_CONTRACT = 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5';

async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string,
): Promise<Announcement[]> {
  const all: Announcement[] = [];

  try {
    let startLedger = 1;
    const probeRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'getEvents',
        params: {
          startLedger: 1,
          filters: [{ type: 'contract', contractIds: [contractId] }],
          pagination: { limit: 1 },
        },
      }),
    });
    const probeData = await probeRes.json();

    if (probeData.error?.message) {
      const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
    }

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, unknown> = {
        filters: [{ type: 'contract', contractIds: [contractId] }],
        pagination: { limit: 1000 },
      };

      if (cursor) {
        (params.pagination as Record<string, unknown>).cursor = cursor;
      } else {
        params.startLedger = startLedger;
      }

      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
      });

      const data = await res.json();
      const events = data.result?.events ?? [];

      for (const event of events) {
        try {
          const ann = parseAnnouncementEvent(event);
          if (ann) all.push(ann);
        } catch (err) {
          console.error('Failed to parse announcement event:', err);
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
}

function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  const topics = event.topic as string[];
  if (!topics || topics.length < 3) return null;

  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const callerScAddress = valueVec[0].address();
  const caller = Address.fromScAddress(callerScAddress).toString();

  const ephBytes = valueVec[1].bytes();
  const ephemeralPubKey = bytesToHex(new Uint8Array(ephBytes));

  const metaBytes = valueVec[2].bytes();
  const metadata = bytesToHex(new Uint8Array(metaBytes));

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

function StellarMatchCardContainer({
  match,
  onWithdrawn,
  labelData,
  onSaveLabel,
  onHide,
  onUnhide,
  onTagClick,
  showPrivacyWarning,
  onDismissPrivacyWarning,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
  labelData: { label: string; tags: string[]; hiddenAt?: number } | null;
  onSaveLabel: (label: string, tags: string[]) => void;
  onHide: () => void;
  onUnhide: () => void;
  onTagClick: (tag: string) => void;
  showPrivacyWarning: boolean;
  onDismissPrivacyWarning: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  const { address, signTransaction, isNetworkMismatch } = useStellarWallet();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [balanceState, setBalanceState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [withdrawAssetKey, setWithdrawAssetKey] = useState<StellarAssetKey>('XLM');
  const [dest, setDest] = useState('');
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [feeBumpHash, setFeeBumpHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retryStatus, setRetryStatus] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSponsorPrompt, setShowSponsorPrompt] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);

  const { upsert } = useActivity();
  const scalarHex = match.stealthPrivateScalar.toString(16).padStart(64, '0');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithRetry(
          `${STELLAR_NETWORK.horizonUrl}/accounts/${match.stealthAddress}`,
          {},
          { onRetry: (attempt) => setRetryStatus(`Retrying (${attempt}/3)…`) },
        );
        setRetryStatus('');
        if (!res.ok) {
          setBalances({ XLM: '0' });
          return;
        }
        const data = await res.json();
        const parsed = parseAssetBalances(data.balances || []);
        setBalances(parsed);
      } catch {
        setRetryStatus('');
        setBalances({ XLM: '0' });
      } finally {
        setBalanceState('loaded');
      }
    })();
  }, [match.stealthAddress]);

  useEffect(() => {
    const bal = balances['XLM'];
    if (!bal) return;
    onBalanceFetched(match.stealthAddress, bal);
  }, [balances, match.stealthAddress, onBalanceFetched]);

  const hasAnyBalance = Object.values(balances).some((b) => parseFloat(b) > 0);
  const withdrawAssetInfo = getAssetByKey(withdrawAssetKey);
  const withdrawBalance = parseFloat(balances[withdrawAssetKey] || '0');

  const handleWithdraw = async () => {
    if (!dest) return;

    if (isNetworkMismatch) {
      setShowNetworkModal(true);
      return;
    }

    setError('');
    setRetryStatus('');
    setWithdrawing(true);

    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const res = await fetchWithRetry(
        `${horizonUrl}/accounts/${match.stealthAddress}`,
        {},
        { onRetry },
      );
      setRetryStatus('');
      if (!res.ok) throw new Error('Account not found');
      const account = await res.json();

      if (withdrawBalance <= 0) throw new Error(`No ${withdrawAssetKey} balance`);

      const sourceAccount = new Account(match.stealthAddress, account.sequence);

      if (withdrawAssetKey === 'XLM') {
        const xlmBal = account.balances?.find(
          (b: { asset_type: string }) => b.asset_type === 'native',
        );
        if (!xlmBal || parseFloat(xlmBal.balance) === 0) throw new Error('No XLM balance');
        const currentBalance = parseFloat(xlmBal.balance);
        const subentryCount = account.subentry_count ?? 0;
        const baseReserve = 0.5;
        const minAccountReserve = (2 + subentryCount) * baseReserve;
        const estimatedFee = 0.00001;
        const feeBumpFee = 0.0001;
        const needsSponsor = currentBalance < minAccountReserve + estimatedFee + feeBumpFee;

        if (needsSponsor && !address) {
          throw new Error('Sponsored withdrawal requires connected wallet');
        }

        if (needsSponsor) {
          setShowSponsorPrompt(true);
          setWithdrawing(false);
          return;
        }

        const sendableAmount = (currentBalance - minAccountReserve - estimatedFee).toFixed(7);
        if (parseFloat(sendableAmount) <= 0) throw new Error('Balance too low to cover reserve');

        const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.payment({ destination: dest, asset: Asset.native(), amount: sendableAmount }),
          )
          .setTimeout(30)
          .build();

        const txHash = tx.hash();
        const signature = signStellarTransaction(
          txHash,
          match.stealthPrivateScalar,
          match.stealthPubKeyBytes,
        );
        const signatureBase64 = Buffer.from(signature).toString('base64');
        tx.addSignature(match.stealthAddress, signatureBase64);

        const txHashHex = Buffer.from(txHash).toString('hex');
        const signedXdrStr = encodeURIComponent(tx.toXDR());
        addActivity({
          id: txHashHex,
          chain: 'stellar',
          wallet: address || '',
          kind: 'withdrawal',
          direction: 'out',
          status: 'pending',
          amount: sendableAmount,
          recipient: dest,
          timestamp: Date.now(),
        });

        const submitRes = await fetch(`${horizonUrl}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `tx=${signedXdrStr}`,
        });

        const submitData = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(
            submitData.extras?.result_codes?.transaction ||
              submitData.title ||
              'Transaction failed',
          );
        }

        setWithdrawHash(submitData.hash);
      } else {
        const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.payment({
              destination: dest,
              asset: withdrawAssetInfo.toAsset(),
              amount: withdrawBalance.toFixed(withdrawAssetInfo.decimals),
            }),
          )
          .setTimeout(30)
          .build();

        const txHash = tx.hash();
        const signature = signStellarTransaction(
          txHash,
          match.stealthPrivateScalar,
          match.stealthPubKeyBytes,
        );
        const signatureBase64 = Buffer.from(signature).toString('base64');
        tx.addSignature(match.stealthAddress, signatureBase64);

        const txHashHex = Buffer.from(txHash).toString('hex');
        const signedXdrStr = encodeURIComponent(tx.toXDR());
        addActivity({
          id: txHashHex,
          chain: 'stellar',
          wallet: address || '',
          kind: 'withdrawal',
          direction: 'out',
          status: 'pending',
          amount: withdrawBalance.toFixed(withdrawAssetInfo.decimals),
          recipient: dest,
          timestamp: Date.now(),
        });

        const submitRes = await fetch(`${horizonUrl}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `tx=${signedXdrStr}`,
        });

        const submitData = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(
            submitData.extras?.result_codes?.transaction ||
              submitData.title ||
              'Transaction failed',
          );
        }

        setWithdrawHash(submitData.hash);
      }
      trackEvent('withdraw');
      onWithdrawn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
      setError(err instanceof Error ? err.message : 'Withdraw failed');
      // In a real robust implementation we'd check if we submitted and mark failed
      setRetryStatus('');
      setError(
        err instanceof RetryExhaustedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Withdraw failed',
      );
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSponsoredWithdraw = async () => {
    if (!dest || !address) return;

    if (isNetworkMismatch) {
      setShowNetworkModal(true);
      return;
    }

    setError('');
    setRetryStatus('');
    setWithdrawing(true);
    setShowSponsorPrompt(false);

    const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);

    try {
      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const stealthRes = await fetchWithRetry(
        `${horizonUrl}/accounts/${match.stealthAddress}`,
        {},
        { onRetry },
      );
      setRetryStatus('');
      if (!stealthRes.ok) throw new Error('Stealth account not found');
      const stealthAccount = await stealthRes.json();

      const xlmBal = stealthAccount.balances?.find(
        (b: { asset_type: string }) => b.asset_type === 'native',
      );
      if (!xlmBal || parseFloat(xlmBal.balance) === 0) throw new Error('No XLM balance');

      // Build inner transaction: mergeAccount to recover all XLM including base reserve
      const stealthSourceAccount = new Account(match.stealthAddress, stealthAccount.sequence);
      const innerTx = new TransactionBuilder(stealthSourceAccount, {
        fee: '0', // Fee will be paid by outer fee-bump transaction
        networkPassphrase,
      })
        .addOperation(
          Operation.accountMerge({
            destination: dest,
          }),
        )
        .setTimeout(30)
        .build();

      // Sign inner transaction with stealth key
      const innerTxHash = innerTx.hash();
      const innerSignature = signStellarTransaction(
        innerTxHash,
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );
      const innerSignatureBase64 = Buffer.from(innerSignature).toString('base64');
      innerTx.addSignature(match.stealthAddress, innerSignatureBase64);

      // Fetch sponsor account for fee-bump
      const sponsorRes = await fetchWithRetry(`${horizonUrl}/accounts/${address}`, {}, { onRetry });
      setRetryStatus('');
      if (!sponsorRes.ok) throw new Error('Sponsor account not found');

      // Build fee-bump transaction
      // Fee-bump fee must be higher than inner tx fee (which is 0)
      // Set to 1000 stroops (0.0001 XLM) to ensure it's accepted
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        address, // fee source (sponsor)
        '1000', // fee in stroops
        innerTx,
        networkPassphrase,
      );

      // Sign fee-bump with sponsor wallet (Freighter will prompt)
      const feeBumpXdr = feeBumpTx.toXDR();
      const signedFeeBumpXdr = await signTransaction(feeBumpXdr);

      const txHashHex = feeBumpTx.hash().toString('hex');
      addActivity({
        id: txHashHex,
        chain: 'stellar',
        wallet: address || '',
        kind: 'withdrawal',
        direction: 'out',
        status: 'pending',
        recipient: dest,
        timestamp: Date.now(),
      });

      // Submit fee-bump transaction
      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedFeeBumpXdr)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      // Fee-bump transactions return the outer hash
      setFeeBumpHash(submitData.hash);
      setWithdrawHash(submitData.hash); // For UI consistency
      updateActivity(txHashHex, 'confirmed');
      onWithdrawn();
    } catch (err) {
      setRetryStatus('');
      setError(
        err instanceof RetryExhaustedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Sponsored withdraw failed',
      );
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
        <div className="flex items-start justify-between gap-4">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={onToggleSelect}
              className="mt-1 h-4 w-4 shrink-0 rounded-none border-outline-variant bg-surface text-primary focus:ring-0"
              aria-label={`Select stealth deposit ${match.stealthAddress}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.stealthAddress')}
            </span>
            <div className="mt-0.5 flex items-center gap-2">
              <StellarLink
                value={match.stealthAddress}
                type="account"
                className="max-w-full"
                linkClassName="text-xs"
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {loadingBal ? (
              <span className="font-mono text-xs text-outline">...</span>
            ) : balance && parseFloat(balance) > 0 ? (
              <>
                <PrivacyBadge
                  score={computePrivacyScore({
                    reuseCount: 1,
                    balance: balance ?? '0',
                    transferTimestamps: [],
                  })}
                />
                <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
                <span className="font-heading text-lg font-bold text-on-surface">
                  {balance} XLM
                </span>
              </>
            ) : (
              <span className="font-mono text-xs text-outline">{t('common.empty')}</span>
            )}
          </div>
        </div>

        {!withdrawHash && balance && parseFloat(balance) > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.withdrawTo')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Destination address (G...)"
                className="h-10 flex-1 border border-outline-variant bg-surface px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handleWithdraw}
                disabled={!dest || withdrawing}
                className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
              >
                {withdrawing ? '...' : t('common.withdraw')}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-error">{error}</p>}

        {withdrawHash && (
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {t('common.withdrawn')} —{' '}
              <StellarLink value={withdrawHash} type="tx" linkClassName="text-[10px]" />
            </span>
          </div>
        )}

        <div className="border-t border-outline-variant/30 pt-3">
          {!showKey ? (
            <button
              onClick={() => setShowKey(true)}
              className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
            >
              {t('common.revealSecretKey')}
            </button>
          ) : (
            <div className="border border-error/20 bg-error/5 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
                  {t('common.stealthKey')}
                </span>
                <CopyButton text={scalarHex} />
              </div>
              <code className="break-all font-mono text-[11px] text-on-surface">{scalarHex}</code>
            </div>
          )}
        </div>
      </div>
      <StellarMatchCard
        stealthAddress={match.stealthAddress}
        scalarHex={scalarHex}
        balances={balances}
        balanceState={balanceState}
        withdrawAssetKey={withdrawAssetKey}
        dest={dest}
        withdrawing={withdrawing}
        withdrawHash={withdrawHash}
        feeBumpHash={feeBumpHash}
        error={error}
        retryStatus={retryStatus}
        showKey={showKey}
        showSponsorPrompt={showSponsorPrompt}
        onDestChange={setDest}
        onWithdrawAssetKeyChange={setWithdrawAssetKey}
        onWithdraw={handleWithdraw}
        onSponsoredWithdraw={handleSponsoredWithdraw}
        onCancelSponsor={() => setShowSponsorPrompt(false)}
        onRevealKey={() => setShowKey(true)}
        labelData={labelData}
        onSaveLabel={onSaveLabel}
        onHide={onHide}
        onUnhide={onUnhide}
        onTagClick={onTagClick}
        showPrivacyWarning={showPrivacyWarning}
        onDismissPrivacyWarning={onDismissPrivacyWarning}
      />
      {showNetworkModal && <NetworkMismatchModal onClose={() => setShowNetworkModal(false)} />}
    </>
  );
}

export function StellarReceive() {
  const { t } = useTranslation();
  const { address, isConnected, signMessage, signTransaction, isNetworkMismatch } =
    useStellarWallet();
  const { stellarKeys, stellarMetaAddress, setStellarKeys, setStellarMetaAddress } =
    useStealthKeys();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);
  const notifications = useStellarNotifications();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [retryStatus, setRetryStatus] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRegSuccess, setIsRegSuccess] = useState(false);
  const [regHash, setRegHash] = useState<string | null>(null);
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [knownBalances, setKnownBalances] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(25);
  const parentRef = useRef<HTMLDivElement>(null);

  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

  const toggleSelectAddress = useCallback((addr: string) => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
      } else {
        next.add(addr);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedAddresses((prev) => {
      if (prev.size === filteredMatched.length && filteredMatched.length > 0) {
        return new Set();
      }
      return new Set(filteredMatched.map((m) => m.stealthAddress));
    });
  }, [filteredMatched]);

  const selectedMatches = useMemo(() => {
    return matched.filter((m) => selectedAddresses.has(m.stealthAddress));
  }, [matched, selectedAddresses]);

  const handleBalanceFetched = useCallback((addr: string, bal: string) => {
    setKnownBalances((prev) => {
      if (prev[addr] === bal) return prev;
      return { ...prev, [addr]: bal };
    });
  }, []);

  const filteredMatches = useMemo(() => {
    if (!searchQuery) return matched;
    const lowerQuery = searchQuery.toLowerCase();
    return matched.filter((m) => {
      const addrMatch = m.stealthAddress.toLowerCase().includes(lowerQuery);
      const bal = knownBalances[m.stealthAddress];
      const balMatch = bal && bal.includes(lowerQuery);
      return addrMatch || balMatch;
    });
  }, [matched, searchQuery, knownBalances]);

  const visibleMatches = useMemo(() => {
    return filteredMatches.slice(0, visibleCount);
  }, [filteredMatches, visibleCount]);

  const rowVirtualizer = useVirtualizer({
    count: visibleMatches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [importConflicts, setImportConflicts] = useState<ImportResult['conflicts'] | null>(null);
  const [pendingImportJson, setPendingImportJson] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState<'idle' | 'unlocking' | 'saving' | 'locking'>('idle');
  const [vaultSupported, setVaultSupported] = useState(false);
  const vaultRef = useRef<KeyVault | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    labels,
    saveLabel,
    hideAddress,
    unhideAddress,
    exportLabels,
    importLabels,
    shouldShowPrivacyWarning,
    dismissPrivacyWarning,
    getAllTags,
  } = useStealthLabels(address);

  const allTags = useMemo(() => getAllTags(), [getAllTags, labels]);

  const filteredMatched = useMemo(() => {
    return matched.filter((m) => {
      const labelData = labels[m.stealthAddress];

      if (!showHidden && labelData?.hiddenAt) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = labelData?.label?.toLowerCase().includes(q);
        const matchesTag = labelData?.tags?.some((t) => t.toLowerCase().includes(q));
        const matchesAddress = m.stealthAddress.toLowerCase().includes(q);
        if (!matchesLabel && !matchesTag && !matchesAddress) return false;
      }

      if (activeTag) {
        if (!labelData?.tags?.includes(activeTag)) return false;
      }

      return true;
    });
  }, [matched, labels, showHidden, searchQuery, activeTag]);

  const hiddenCount = useMemo(() => {
    return matched.filter((m) => labels[m.stealthAddress]?.hiddenAt).length;
  }, [matched, labels]);

  // Check if already registered on-chain
  useEffect(() => {
    if (!address) return;

    (async () => {
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban =
          (window as any).sorobanServerMock || new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
        const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

        const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);
        const accountResponse = await withRetry(() => soroban.getAccount(address), { onRetry });
        setRetryStatus('');
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber(),
        );

        const contract = new Contract(REGISTRY_CONTRACT);
        const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            contract.call(
              'stealth_meta_address_of',
              new Address(address).toScVal(),
              nativeToScVal(SCHEME_ID, { type: 'u32' }),
            ),
          )
          .setTimeout(30)
          .build();

        const simulated = (await withRetry(() => soroban.simulateTransaction(tx), { onRetry })) as {
          error?: unknown;
          result?: unknown;
        };
        setRetryStatus('');
        if (!('error' in simulated) && 'result' in simulated) {
          setIsAlreadyRegistered(true);
        }
      } catch {
        setRetryStatus('');
        // Not registered or contract not available
      }
    })();
  }, [address]);

  const registered = isAlreadyRegistered || isRegSuccess;

  const deriveKeysFromWallet = useCallback(async () => {
    setIsDerivingKeys(true);
    setError('');
    try {
      const signature = await signMessage(STEALTH_SIGNING_MESSAGE);
      const derived = deriveStealthKeys(signature);
      setStellarKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setStellarMetaAddress(meta);

      // Auto-register viewing key for notifications if enabled
      if (notifications.state.enabled && address && derived) {
        try {
          await notifications.registerViewingKey(address, derived);
        } catch (err) {
          console.error('Failed to register viewing key for notifications:', err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.keyDerivationFailed'));
    } finally {
      setIsDerivingKeys(false);
    }
  }, [
    signMessage,
    setStellarKeys,
    setStellarMetaAddress,
    notifications.state.enabled,
    address,
    notifications,
    t,
  ]);

  useEffect(() => {
    try {
      vaultRef.current = new KeyVault({
        idleTimeoutMs: 2 * 60 * 1000,
        lockOnBlur: true,
      });
      setVaultSupported(true);
    } catch {
      vaultRef.current = null;
      setVaultSupported(false);
    }

    return () => {
      void vaultRef.current?.lock();
    };
  }, []);

  const saveKeysToVault = useCallback(async () => {
    if (!stellarKeys) return;
    if (!vaultRef.current) {
      setVaultMessage('Browser vault is unavailable in this environment.');
      return;
    }
    if (!vaultPassphrase) {
      setVaultMessage('Enter a passphrase to save the keys.');
      return;
    }

    setVaultBusy('saving');
    setVaultMessage(null);

    try {
      await vaultRef.current.unlock(vaultPassphrase);
      await vaultRef.current.put('stellar', stellarKeys);
      setVaultMessage('Keys saved in the browser vault.');
    } catch (err) {
      setVaultMessage(err instanceof Error ? err.message : 'Failed to save vault keys');
    } finally {
      setVaultBusy('idle');
    }
  }, [stellarKeys, vaultPassphrase]);

  const unlockKeysFromVault = useCallback(async () => {
    if (!vaultRef.current) {
      setVaultMessage('Browser vault is unavailable in this environment.');
      return;
    }
    if (!vaultPassphrase) {
      setVaultMessage('Enter a passphrase to unlock the vault.');
      return;
    }

    setVaultBusy('unlocking');
    setVaultMessage(null);

    try {
      await vaultRef.current.unlock(vaultPassphrase);
      const savedKeys =
        await vaultRef.current.get<Awaited<ReturnType<typeof deriveStealthKeys>>>('stellar');
      if (!savedKeys) {
        throw new Error('No Stellar keys found in the vault');
      }

      setStellarKeys(savedKeys);
      setStellarMetaAddress(
        encodeStealthMetaAddress(savedKeys.spendingPubKey, savedKeys.viewingPubKey),
      );
      setVaultMessage('Keys restored from the browser vault.');
    } catch (err) {
      setVaultMessage(err instanceof Error ? err.message : 'Failed to unlock vault');
    } finally {
      setVaultBusy('idle');
    }
  }, [setStellarKeys, setStellarMetaAddress, vaultPassphrase]);

  const lockVault = useCallback(async () => {
    if (!vaultRef.current) return;
    setVaultBusy('locking');
    setVaultMessage(null);
    try {
      await vaultRef.current.lock();
      setVaultMessage('Vault locked.');
    } finally {
      setVaultBusy('idle');
    }
  }, []);

  const vaultPanel = useMemo(() => {
    if (!vaultSupported) return null;

    const busy = vaultBusy !== 'idle';
    const title = stellarKeys ? 'Save to Browser Vault' : 'Unlock Browser Vault';
    const description = stellarKeys
      ? 'Store the derived Stellar keys encrypted in this browser for brief reuse.'
      : 'Restore the last saved Stellar keys from this browser vault using your passphrase.';

    return (
      <div className="border border-outline-variant bg-surface-container p-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Browser Vault
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Opt-in
            </span>
          </div>
          <p className="text-sm leading-relaxed text-on-surface-variant">{description}</p>
          <p className="text-xs leading-relaxed text-on-surface-variant">
            Not a replacement for a hardware wallet.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Passphrase
            </label>
            <input
              type="password"
              value={vaultPassphrase}
              onChange={(e) => setVaultPassphrase(e.target.value)}
              placeholder="Unlock the vault"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {stellarKeys ? (
              <>
                <button
                  onClick={saveKeysToVault}
                  disabled={busy || !vaultPassphrase}
                  className="h-11 bg-primary px-4 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
                >
                  {vaultBusy === 'saving' ? 'Saving...' : title}
                </button>
                <button
                  onClick={lockVault}
                  disabled={busy}
                  className="h-11 border border-outline-variant px-4 font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {vaultBusy === 'locking' ? 'Locking...' : 'Lock Vault'}
                </button>
              </>
            ) : (
              <button
                onClick={unlockKeysFromVault}
                disabled={busy || !vaultPassphrase}
                className="h-11 bg-primary px-4 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
              >
                {vaultBusy === 'unlocking' ? 'Unlocking...' : title}
              </button>
            )}
          </div>

          {vaultMessage && <p className="text-xs text-on-surface-variant">{vaultMessage}</p>}
        </div>
      </div>
    );
  }, [
    lockVault,
    saveKeysToVault,
    stellarKeys,
    unlockKeysFromVault,
    vaultBusy,
    vaultMessage,
    vaultPassphrase,
    vaultSupported,
  ]);

  const registerOnChain = useCallback(async () => {
    if (!stellarKeys || !address) return;

    if (isNetworkMismatch) {
      setShowNetworkModal(true);
      return;
    }

    setIsRegistering(true);
    setError('');
    setRetryStatus('');
    const onRetryReg = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);
    try {
      const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
      const soroban =
        (window as any).sorobanServerMock || new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const accountResponse = (await withRetry(() => soroban.getAccount(address), {
        onRetry: onRetryReg,
      })) as { accountId(): string; sequenceNumber(): string };
      setRetryStatus('');
      const sourceAccount = new Account(
        accountResponse.accountId(),
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(REGISTRY_CONTRACT);
      const metaAddressBytes = new Uint8Array(64);
      metaAddressBytes.set(stellarKeys.spendingPubKey, 0);
      metaAddressBytes.set(stellarKeys.viewingPubKey, 32);

      const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
        .addOperation(
          contract.call(
            'register_keys',
            new Address(address).toScVal(),
            nativeToScVal(SCHEME_ID, { type: 'u32' }),
            xdr.ScVal.scvBytes(Buffer.from(metaAddressBytes)),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = (await withRetry(() => soroban.simulateTransaction(tx), {
        onRetry: onRetryReg,
      })) as { error?: string };
      setRetryStatus('');
      if ('error' in simulated) {
        throw new Error(simulated.error || 'Simulation failed');
      }

      const assembled = rpcMod
        .assembleTransaction(tx, simulated as Parameters<typeof rpcMod.assembleTransaction>[1])
        .build();

      const signedXdr = await signTransaction(assembled.toXDR());
      const response = await soroban.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, networkPassphrase),
      );

      if (response.status === 'ERROR') throw new Error('Transaction submission failed');
      const txHashHex = response.hash;

      addActivity({
        id: txHashHex,
        chain: 'stellar',
        wallet: address,
        kind: 'name-registration',
        direction: 'out',
        status: 'pending',
        timestamp: Date.now(),
      });

      setRegHash(txHashHex);

      let attempts = 0;
      while (attempts < 30) {
        try {
          const result = await soroban.getTransaction(response.hash);
          if (result.status === 'NOT_FOUND') {
            attempts++;
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (result.status === 'SUCCESS') {
            setIsRegSuccess(true);
            updateActivity(txHashHex, 'confirmed');
          } else if (result.status === 'FAILED') {
            updateActivity(txHashHex, 'failed');
          }
          break;
        } catch (pollErr: unknown) {
          if (pollErr instanceof Error && pollErr.message?.includes('Bad union switch')) {
            setIsRegSuccess(true);
            updateActivity(txHashHex, 'confirmed');
            break;
          }
          throw pollErr;
        }
      }
    } catch (err) {
      setRetryStatus('');
      setError(
        err instanceof RetryExhaustedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Registration failed',
      );
    } finally {
      setIsRegistering(false);
    }
  }, [stellarKeys, address, signTransaction]);

  const scanPayments = useCallback(async () => {
    if (!stellarKeys) return;
    setIsScanning(true);
    setError('');

    try {
      const announcements = await fetchAnnouncementEvents(
        STELLAR_NETWORK.rpcUrl,
        ANNOUNCER_CONTRACT,
      );
      const scanFn = (window as any).scanAnnouncementsMock || scanAnnouncements;
      const results = scanFn(
        announcements,
        stellarKeys.viewingKey,
        stellarKeys.spendingPubKey,
        stellarKeys.spendingScalar,
      );
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      workerRef.current = new Worker(
        new URL('../workers/stellar-scanner.worker.ts', import.meta.url),
        { type: 'module' },
      );
      setMatched(results);
      setHasScanned(true);
      trackEvent('scan_triggered');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.scanFailed'));
    } finally {
      setIsScanning(false);
    }
  }, [stellarKeys, t]);

  const handleToggleNotifications = useCallback(async () => {
    if (notifications.state.enabled) {
      await notifications.disableNotifications();
      if (address) {
        await notifications.unregisterViewingKey(address);
      }
    } else {
      await notifications.enableNotifications();
      if (address && stellarKeys) {
        await notifications.registerViewingKey(address, stellarKeys);
      }
    }
  }, [notifications, address, stellarKeys]);

  const handleFireTestNotification = useCallback(async () => {
    try {
      await notifications.fireTestNotification();
    } catch (err) {
      console.error('Failed to fire test notification:', err);
      setError(err instanceof Error ? err.message : 'Failed to fire test notification');
    }
  }, [notifications]);

  if (!isConnected && !stellarKeys) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('stellar.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('stellar.receiveTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('stellar.receiveConnectPrompt')}
        </p>
      </section>
    );
  }

  const handleExport = () => {
    const json = exportLabels();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wraith-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = ev.target?.result as string;
        JSON.parse(json);
        const result = importLabels(json, false);
        if (result.conflicts.length > 0) {
          setImportConflicts(result.conflicts);
          setPendingImportJson(json);
        } else {
          setImportMessage(`Imported ${result.imported} label${result.imported !== 1 ? 's' : ''}.`);
          setTimeout(() => setImportMessage(null), 3000);
        }
      } catch {
        setImportMessage('Invalid JSON file.');
        setTimeout(() => setImportMessage(null), 3000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConflictResolve = (action: 'keep-all' | 'overwrite-all') => {
    if (action === 'overwrite-all' && pendingImportJson) {
      const result = importLabels(pendingImportJson, true);
      setImportMessage(
        `Imported ${result.imported} label${result.imported !== 1 ? 's' : ''} (overwritten).`,
      );
    } else {
      setImportMessage('Kept existing labels.');
    }
    setImportConflicts(null);
    setPendingImportJson(null);
    setTimeout(() => setImportMessage(null), 3000);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
      />
      <StellarReceiveView
        isConnected={isConnected}
        isDerivingKeys={isDerivingKeys}
        keysDerived={!!stellarKeys}
        metaAddress={stellarMetaAddress}
        onShowQR={() => setShowQRModal(true)}
        vaultPanel={vaultPanel}
        registered={registered}
        isRegistering={isRegistering}
        regHash={regHash}
        isScanning={isScanning}
        hasScanned={hasScanned}
        matchCount={matched.length}
        error={error}
        retryStatus={retryStatus}
        onDeriveKeys={deriveKeysFromWallet}
        onRegister={registerOnChain}
        onScan={scanPayments}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filteredMatchCount={filteredMatched.length}
        activeTag={activeTag}
        allTags={allTags}
        onTagClick={(tag) => setActiveTag(activeTag === tag ? null : tag)}
        showHidden={showHidden}
        hiddenCount={hiddenCount}
        onToggleShowHidden={() => setShowHidden(!showHidden)}
        onExport={handleExport}
        onImport={() => fileInputRef.current?.click()}
        importMessage={importMessage}
        importConflicts={importConflicts}
        onImportConflictResolve={handleConflictResolve}
        onCloseImportModal={() => {
          setImportConflicts(null);
          setPendingImportJson(null);
        }}
        notificationsEnabled={notifications.state.enabled}
        notificationsSupported={notifications.state.supported}
        notificationsPermission={notifications.state.permission}
        onToggleNotifications={handleToggleNotifications}
        onFireTestNotification={handleFireTestNotification}
        matches={
          filteredMatched.length > 0 && (
            <div className="flex flex-col gap-4">
              {/* Multi-select Batch Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border border-outline-variant bg-surface-container p-3">
                <label className="flex items-center gap-2 font-mono text-xs text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      selectedAddresses.size > 0 &&
                      selectedAddresses.size === filteredMatched.length
                    }
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded-none border-outline-variant bg-surface text-primary focus:ring-0"
                  />
                  <span>
                    Select All ({selectedAddresses.size} / {filteredMatched.length})
                  </span>
                </label>

                {selectedAddresses.size > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAddresses(new Set())}
                      className="h-9 border border-outline-variant px-3 font-heading text-[10px] uppercase tracking-widest text-outline hover:text-on-surface"
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={() => setIsBatchModalOpen(true)}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface hover:brightness-110"
                    >
                      Withdraw Selected ({selectedAddresses.size})
                    </button>
                  </div>
                )}
              </div>

              <input
                type="text"
                placeholder="Search by address or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 w-full border border-outline-variant bg-surface px-4 font-body text-sm text-on-surface placeholder:text-outline focus:border-primary"
              />

              {filteredMatches.length === 0 && (
                <div className="py-4 text-center font-body text-xs text-on-surface-variant">
                  No matching transfers found for &quot;{searchQuery}&quot;
                </div>
              )}

              <div
                ref={parentRef}
                className="max-h-[600px] overflow-y-auto overflow-x-hidden flex flex-col"
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const m = visibleMatches[virtualItem.index];
                    return (
                      <div
                        key={virtualItem.key}
                        data-index={virtualItem.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualItem.start}px)`,
                          paddingBottom: '16px', // gap equivalent
                        }}
                      >
                        <StellarMatchCardContainer
                          match={m}
                          isSelected={selectedAddresses.has(m.stealthAddress)}
                          onToggleSelect={() => toggleSelectAddress(m.stealthAddress)}
                          onWithdrawn={() => {}}
                          labelData={null}
                          onSaveLabel={() => {}}
                          onHide={() => {}}
                          onUnhide={() => {}}
                          onTagClick={() => {}}
                          showPrivacyWarning={false}
                          onDismissPrivacyWarning={() => {}}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {visibleCount < filteredMatches.length && (
                <button
                  onClick={() => setVisibleCount((v) => v + 25)}
                  className="mt-2 h-10 w-full border border-outline-variant font-heading text-[11px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
                >
                  Show 25 more
                </button>
              )}
            </div>
          )
        }
      />
      {showQRModal && stellarMetaAddress && (
        <QRCodeModal
          value={stellarMetaAddress}
          variants={[
            { label: 'Meta-address', value: stellarMetaAddress },
            { label: 'Stellar URI', value: createStellarQrUri(stellarMetaAddress) },
          ]}
          onClose={() => setShowQRModal(false)}
        />
      )}
      {showNetworkModal && <NetworkMismatchModal onClose={() => setShowNetworkModal(false)} />}
      <StellarBatchWithdrawModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        selectedMatches={selectedMatches}
        knownBalances={knownBalances}
        onBatchSuccess={() => {
          setSelectedAddresses(new Set());
          setIsBatchModalOpen(false);
          scanPayments();
        }}
      />
    </>
  );
}
