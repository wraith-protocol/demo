import { useTransactionState } from '@/hooks/useTransactionState';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { useTranslation } from 'react-i18next';
import { useScanStrategy } from '@/context/ScanStrategyContext';
import { StellarReceiveView } from '@/components/StellarReceiveView';
import { StellarMatchCard } from '@/components/StellarMatchCard';
import { QRCodeModal } from '@/components/QRCodeModal';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';
import { getStellarContractId } from '@/lib/stellar/deployments';
import { getSorobanServer } from '@/lib/stellar/sorobanClient';
import { withRetry, RetryExhaustedError } from '@/lib/stellar/retry';
import { useActivityStore } from '@/stores/activityStore';
import type { ImportResult } from '@/lib/stealthLabels';
import { useStellarNotifications } from '@/hooks/useStellarNotifications';
import { useStellarVault } from '@/hooks/useStellarVault';
import { useStellarWithdrawal } from '@/hooks/useStellarWithdrawal';
import { useStellarScanner } from '@/hooks/useStellarScanner';
import { NetworkMismatchModal } from '@/components/NetworkMismatchModal';
import { useStealthLabels } from '@/hooks/useStealthLabels';
import { StellarBatchWithdrawModal } from '@/components/StellarBatchWithdrawModal';
import { createStellarQrUri } from '@/utils/qr';

interface StellarMatchCardContainerProps {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
  onBalanceFetched: (address: string, balance: string) => void;
  labelData: { label: string; tags: string[]; hiddenAt?: number } | null;
  onSaveLabel: (label: string, tags: string[]) => void;
  onHide: () => void;
  onUnhide: () => void;
  onTagClick: (tag: string) => void;
  showPrivacyWarning: boolean;
  onDismissPrivacyWarning: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

function StellarMatchCardContainer({
  match,
  onWithdrawn,
  onBalanceFetched,
  labelData,
  onSaveLabel,
  onHide,
  onUnhide,
  onTagClick,
  showPrivacyWarning,
  onDismissPrivacyWarning,
  isSelected,
  onToggleSelect,
}: StellarMatchCardContainerProps) {
  const withdrawal = useStellarWithdrawal({ match, onBalanceFetched, onWithdrawn });
  const scalarHex = match.stealthPrivateScalar.toString(16).padStart(64, '0');

  return (
    <>
      {onToggleSelect && (
        <label className="flex items-center gap-2 font-mono text-xs text-on-surface">
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded-none border-outline-variant bg-surface text-primary focus:ring-0"
            aria-label={`Select stealth deposit ${match.stealthAddress}`}
          />
          Select deposit
        </label>
      )}
      <StellarMatchCard
        stealthAddress={match.stealthAddress}
        scalarHex={scalarHex}
        balances={withdrawal.balances}
        balanceState={withdrawal.balanceState}
        withdrawAssetKey={withdrawal.withdrawAssetKey}
        dest={withdrawal.dest}
        withdrawing={withdrawal.withdrawing}
        withdrawHash={withdrawal.withdrawHash}
        feeBumpHash={withdrawal.feeBumpHash}
        error={withdrawal.error}
        retryStatus={withdrawal.retryStatus}
        showKey={withdrawal.showKey}
        showSponsorPrompt={withdrawal.showSponsorPrompt}
        onDestChange={withdrawal.setDest}
        onWithdrawAssetKeyChange={withdrawal.setWithdrawAssetKey}
        onWithdraw={() => void withdrawal.withdraw()}
        onSponsoredWithdraw={() => void withdrawal.sponsoredWithdraw()}
        onCancelSponsor={withdrawal.cancelSponsor}
        onRevealKey={() => withdrawal.setShowKey(true)}
        labelData={labelData}
        onSaveLabel={onSaveLabel}
        onHide={onHide}
        onUnhide={onUnhide}
        onTagClick={onTagClick}
        showPrivacyWarning={showPrivacyWarning}
        onDismissPrivacyWarning={onDismissPrivacyWarning}
      />
      {withdrawal.showNetworkModal && (
        <NetworkMismatchModal onClose={() => withdrawal.setShowNetworkModal(false)} />
      )}
    </>
  );
}

export function StellarReceive() {
  const { t } = useTranslation();
  const { address, isConnected, signMessage, signTransaction, isNetworkMismatch } =
    useStellarWallet();
  const { stellarKeys, stellarMetaAddress, setStellarKeys, setStellarMetaAddress } =
    useStealthKeys();
  const { strategy: scanStrategy } = useScanStrategy();
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);
  const notifications = useStellarNotifications();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [error, setError] = useState('');
  const [retryStatus, setRetryStatus] = useState('');

  const scanner = useStellarScanner({ stellarKeys, address, strategy: scanStrategy, t });
  const matched = scanner.matched;
  const isScanning = scanner.isScanning;
  const hasScanned = scanner.hasScanned;
  const retentionGap = scanner.retentionGap;

  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [isRegistering, setIsRegistering] = useTransactionState<boolean>(false, Boolean);
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
  const vault = useStellarVault({ stellarKeys, setStellarKeys, setStellarMetaAddress });
  const vaultPassphrase = vault.passphrase;
  const vaultMessage = vault.message;
  const vaultBusy = vault.busy;
  const vaultSupported = vault.supported;
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

  const toggleSelectAll = useCallback(() => {
    setSelectedAddresses((prev) => {
      if (prev.size === filteredMatched.length && filteredMatched.length > 0) {
        return new Set();
      }
      return new Set(filteredMatched.map((m) => m.stealthAddress));
    });
  }, [filteredMatched]);

  const hiddenCount = useMemo(() => {
    return matched.filter((m) => labels[m.stealthAddress]?.hiddenAt).length;
  }, [matched, labels]);

  // Check if already registered on-chain
  useEffect(() => {
    if (!address) return;

    (async () => {
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban = getSorobanServer(rpcMod);
        const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

        const onRetry = (attempt: number) => setRetryStatus(`Retrying (${attempt}/3)…`);
        const accountResponse = await withRetry(() => soroban.getAccount(address), { onRetry });
        setRetryStatus('');
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber(),
        );

        const contract = new Contract(getStellarContractId('registry'));
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
              onChange={(e) => vault.setPassphrase(e.target.value)}
              placeholder="Unlock the vault"
              className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {stellarKeys ? (
              <>
                <button
                  onClick={() => void vault.save()}
                  disabled={busy || !vaultPassphrase}
                  className="h-11 bg-primary px-4 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
                >
                  {vaultBusy === 'saving' ? 'Saving...' : title}
                </button>
                <button
                  onClick={() => void vault.lock()}
                  disabled={busy}
                  className="h-11 border border-outline-variant px-4 font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {vaultBusy === 'locking' ? 'Locking...' : 'Lock Vault'}
                </button>
              </>
            ) : (
              <button
                onClick={() => void vault.unlock()}
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
  }, [stellarKeys, vault, vaultBusy, vaultMessage, vaultPassphrase, vaultSupported]);

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
      const soroban = getSorobanServer(rpcMod);
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const accountResponse = (await withRetry(() => soroban.getAccount(address), {
        onRetry: onRetryReg,
      })) as { accountId(): string; sequenceNumber(): string };
      setRetryStatus('');
      const sourceAccount = new Account(
        accountResponse.accountId(),
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(getStellarContractId('registry'));
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

  const scanPayments = scanner.scan;
  const recoverRetentionGap = scanner.recoverRetentionGap;

  // (Re)seal the background-scan key whenever it can be used: notifications on,
  // worker ready, keys unlocked. Lock (disconnect / app idle lock) removes the
  // wrapping key; this puts a fresh one back once the keys exist again.
  const registerScanKey = notifications.registerViewingKey;
  const scanNotificationsEnabled = notifications.state.enabled;
  const scanWorkerReady = notifications.state.swRegistered;
  useEffect(() => {
    if (!address || !stellarKeys || !scanNotificationsEnabled || !scanWorkerReady) return;
    registerScanKey(address, stellarKeys).catch((error: unknown) => {
      console.error('Failed to register viewing key:', error);
    });
  }, [address, stellarKeys, scanNotificationsEnabled, scanWorkerReady, registerScanKey]);

  const handleToggleNotifications = useCallback(async () => {
    if (notifications.state.enabled) {
      await notifications.disableNotifications();
      if (address) {
        await notifications.unregisterViewingKey(address);
      }
    } else {
      await notifications.enableNotifications(); // the effect above seals the key
    }
  }, [notifications, address]);

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
        scanStrategyLabel={t('scanStrategy.activeStrategy', {
          strategy: t(`scanStrategy.${scanStrategy}Label`),
        })}
        matchCount={matched.length}
        error={error || scanner.error}
        retentionGap={retentionGap}
        retryStatus={retryStatus}
        onDeriveKeys={deriveKeysFromWallet}
        onRegister={registerOnChain}
        onScan={() => scanPayments()}
        onRecoverRetentionGap={recoverRetentionGap}
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
                          onBalanceFetched={handleBalanceFetched}
                          labelData={labels[m.stealthAddress] ?? null}
                          onSaveLabel={(label, tags) => saveLabel(m.stealthAddress, label, tags)}
                          onHide={() => hideAddress(m.stealthAddress)}
                          onUnhide={() => unhideAddress(m.stealthAddress)}
                          onTagClick={setActiveTag}
                          showPrivacyWarning={shouldShowPrivacyWarning}
                          onDismissPrivacyWarning={dismissPrivacyWarning}
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
