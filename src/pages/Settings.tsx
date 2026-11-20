import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useChain } from '@/context/ChainContext';
import { useScanStrategy, SCAN_STRATEGIES, type ScanStrategy } from '@/context/ScanStrategyContext';
import { getLabels } from '@/lib/stealthLabels';
import {
  exportRecoveryKit,
  importRecoveryKit,
  validatePassphrase,
  generateRecoveryFilename,
  bytesToHex,
} from '@/lib/stellar/recoveryKit';
import { useNotificationSW } from '@/hooks/useNotificationSW';
import { DEFAULT_RELAY_URL } from '@/lib/pushRelay';

type ScanningStrategy = 'fast' | 'balanced' | 'full';

const preferences: Array<{ value: ThemePreference; label: string; description: string }> = [
  {
    value: 'system',
    label: 'System default',
    description: 'Follow your operating system preference.',
  },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

const scanningStrategies: Array<{
  value: ScanningStrategy;
  labelKey: string;
  descriptionKey: string;
  tooltipKey: string;
}> = [
  {
    value: 'fast',
    labelKey: 'stellar.strategyFast',
    descriptionKey: 'stellar.strategyFastDescription',
    tooltipKey: 'stellar.strategyFastTooltip',
  },
  {
    value: 'balanced',
    labelKey: 'stellar.strategyBalanced',
    descriptionKey: 'stellar.strategyBalancedDescription',
    tooltipKey: 'stellar.strategyBalancedTooltip',
  },
  {
    value: 'full',
    labelKey: 'stellar.strategyFull',
    descriptionKey: 'stellar.strategyFullDescription',
    tooltipKey: 'stellar.strategyFullTooltip',
  },
];

export default function Settings() {
  const { t } = useTranslation();
  const { preference, setThemePreference } = useTheme();
  const { strategy, setStrategy } = useScanStrategy();
  const { chain } = useChain();
  const {
    evmKeys,
    evmMetaAddress,
    stellarKeys,
    stellarMetaAddress,
    solanaKeys,
    solanaMetaAddress,
    ckbKeys,
    ckbMetaAddress,
    isRecoveryMode,
    isReadOnly,
    restoreFromRecoveryKit,
    exitRecoveryMode,
  } = useStealthKeys();

  // Web Push Notification State
  const {
    state: pushState,
    requestPermission,
    subscribe,
    unsubscribe,
    testRelay,
    updateRelayUrl,
  } = useNotificationSW();

  // Scanning Strategy State
  const [scanningStrategy, setScanningStrategy] = useState<ScanningStrategy>(() => {
    const saved = localStorage.getItem('wraith-scanning-strategy');
    return (saved as ScanningStrategy) || 'balanced';
  });

  useEffect(() => {
    localStorage.setItem('wraith-scanning-strategy', scanningStrategy);
  }, [scanningStrategy]);

  // Export State
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [includeSpendingScalar, setIncludeSpendingScalar] = useState(true);
  const [exportMessage, setExportMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Restore State
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Web Push UI State
  const [relayUrlInput, setRelayUrlInput] = useState(pushState.relayUrl);
  const [pushMessage, setPushMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);
  const [isTestingRelay, setIsTestingRelay] = useState(false);

  // Active meta-address and keys for current chain
  const activeMetaAddress =
    chain === 'stellar'
      ? stellarMetaAddress
      : chain === 'horizen'
        ? evmMetaAddress
        : chain === 'solana'
          ? solanaMetaAddress
          : ckbMetaAddress;

  const activeKeys =
    chain === 'stellar'
      ? stellarKeys
      : chain === 'horizen'
        ? evmKeys
        : chain === 'solana'
          ? solanaKeys
          : ckbKeys;

  const passphraseStrength = validatePassphrase(exportPassphrase);

  const scanStrategyOptions: Array<{ value: ScanStrategy; label: string; description: string }> =
    SCAN_STRATEGIES.map((value) => ({
      value,
      label: t(`scanStrategy.${value}Label`),
      description: t(`scanStrategy.${value}Description`),
    }));

  const handleExportKit = async () => {
    setExportMessage(null);

    if (!exportPassphrase) {
      setExportMessage({ type: 'error', text: 'Enter a passphrase to encrypt your recovery kit.' });
      return;
    }

    if (!passphraseStrength.valid) {
      setExportMessage({
        type: 'error',
        text: passphraseStrength.message || 'Passphrase must be at least 8 characters long.',
      });
      return;
    }

    if (!activeMetaAddress || !activeKeys) {
      setExportMessage({
        type: 'error',
        text: 'No derived stealth keys active for export. Please derive keys on the Receive page first.',
      });
      return;
    }

    setIsExporting(true);

    try {
      // Extract viewing and spending scalar hex
      const viewingKey = (activeKeys as any).viewingKey || (activeKeys as any).viewingScalar;
      const viewingScalarHex = viewingKey
        ? typeof viewingKey === 'string'
          ? viewingKey
          : bytesToHex(viewingKey as Uint8Array)
        : '';

      const viewingPubKeyHex = activeKeys.viewingPubKey
        ? typeof activeKeys.viewingPubKey === 'string'
          ? activeKeys.viewingPubKey
          : bytesToHex(activeKeys.viewingPubKey as Uint8Array)
        : undefined;
      const spendingPubKeyHex = activeKeys.spendingPubKey
        ? typeof activeKeys.spendingPubKey === 'string'
          ? activeKeys.spendingPubKey
          : bytesToHex(activeKeys.spendingPubKey as Uint8Array)
        : undefined;

      let spendingScalarHex: string | undefined = undefined;
      const spendingScalar = (activeKeys as any).spendingScalar;
      if (includeSpendingScalar && spendingScalar) {
        spendingScalarHex =
          typeof spendingScalar === 'bigint'
            ? spendingScalar.toString(16).padStart(64, '0')
            : String(spendingScalar);
      }

      // Profile labels
      const labels = getLabels(activeMetaAddress);

      const encryptedKit = await exportRecoveryKit({
        passphrase: exportPassphrase,
        chain,
        metaAddress: activeMetaAddress,
        viewingScalarHex,
        viewingPubKeyHex,
        spendingPubKeyHex,
        spendingScalarHex,
        labels,
      });

      // Trigger download
      const filename = generateRecoveryFilename(activeMetaAddress);
      const blob = new Blob([JSON.stringify(encryptedKit, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setExportMessage({
        type: 'success',
        text: `Recovery kit exported successfully as "${filename}". Keep it safe offline!`,
      });
      setExportPassphrase('');
    } catch (err) {
      setExportMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to export recovery kit.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSelectedFileContent(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleRestoreKit = async () => {
    setRestoreMessage(null);

    if (!selectedFileContent) {
      setRestoreMessage({ type: 'error', text: 'Please select a valid recovery kit JSON file.' });
      return;
    }

    if (!restorePassphrase) {
      setRestoreMessage({
        type: 'error',
        text: 'Enter the passphrase used when creating the recovery kit.',
      });
      return;
    }

    setIsRestoring(true);

    try {
      const kitData = await importRecoveryKit(selectedFileContent, restorePassphrase);
      restoreFromRecoveryKit(kitData);

      setRestoreMessage({
        type: 'success',
        text: `Recovery kit successfully restored! Session set to ${
          kitData.spendingScalarHex ? 'full recovery' : 'receive-only'
        } mode for meta-address "${kitData.metaAddress}".`,
      });
      setRestorePassphrase('');
      setSelectedFileContent(null);
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setRestoreMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to restore recovery kit.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // Web Push Handlers
  const handleSubscribe = async () => {
    setPushMessage(null);

    if (!activeMetaAddress) {
      setPushMessage({
        type: 'error',
        text: 'No active meta-address. Derive keys on the Receive page first.',
      });
      return;
    }

    setIsSubscribing(true);

    try {
      await subscribe(activeMetaAddress, relayUrlInput);
      setPushMessage({
        type: 'success',
        text: 'Successfully subscribed to stealth payment alerts via Web Push.',
      });
    } catch (err) {
      setPushMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to subscribe to Web Push.',
      });
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setPushMessage(null);

    if (!activeMetaAddress) {
      setPushMessage({
        type: 'error',
        text: 'No active meta-address to unsubscribe.',
      });
      return;
    }

    setIsUnsubscribing(true);

    try {
      await unsubscribe(activeMetaAddress);
      setPushMessage({
        type: 'success',
        text: 'Successfully unsubscribed from Web Push notifications.',
      });
    } catch (err) {
      setPushMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to unsubscribe from Web Push.',
      });
    } finally {
      setIsUnsubscribing(false);
    }
  };

  const handleTestRelay = async () => {
    setPushMessage(null);
    setIsTestingRelay(true);

    try {
      const reachable = await testRelay(relayUrlInput);
      if (reachable) {
        setPushMessage({
          type: 'success',
          text: 'Relay is reachable and healthy.',
        });
      } else {
        setPushMessage({
          type: 'error',
          text: 'Relay is not reachable. Check the URL and try again.',
        });
      }
    } catch (err) {
      setPushMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to test relay connectivity.',
      });
    } finally {
      setIsTestingRelay(false);
    }
  };

  const handleUpdateRelayUrl = () => {
    updateRelayUrl(relayUrlInput);
    setPushMessage({
      type: 'success',
      text: 'Relay URL updated. Test connectivity to verify.',
    });
  };

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Preferences
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Settings
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Manage application settings, appearance preferences, and offline recovery kits.
        </p>
      </div>

      {/* Active Recovery Mode Banner */}
      {isRecoveryMode && (
        <div className="flex flex-col gap-3 border border-amber-500/40 bg-amber-500/10 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-amber-400">
              Active Session: Recovery Mode
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-amber-400">
              {isReadOnly ? 'Receive-Only (Viewing)' : 'Full Recovery'}
            </span>
          </div>
          <p className="font-body text-xs text-on-surface-variant">
            You are currently scanning past deposits using a restored recovery kit.
          </p>
          <button
            onClick={exitRecoveryMode}
            className="w-fit border border-amber-500/40 bg-surface px-4 py-2 font-heading text-xs font-semibold uppercase tracking-widest text-amber-400 hover:bg-amber-500/20"
          >
            Exit Recovery Mode
          </button>
        </div>
      )}

      {/* Export Recovery Kit */}
      <fieldset className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          Export Recovery Kit
        </legend>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          Export an AES-GCM passphrase-encrypted JSON recovery kit containing your stealth viewing
          scalar, meta-address, active chain, and profile labels. Back it up offline to regain scan
          access on a fresh browser.
        </p>

        <div className="border border-outline-variant/60 bg-surface/50 p-3 font-mono text-xs text-on-surface-variant">
          <span className="font-semibold text-on-surface">Security Notice: </span>
          The kit gives scan access (viewing scalar) and, if included below, spend authority
          (spending scalar). Keep your passphrase and backup file safe!
        </div>

        {activeMetaAddress ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Active Meta-Address
            </span>
            <code className="break-all border border-outline-variant bg-surface p-2.5 font-mono text-xs text-primary">
              {activeMetaAddress}
            </code>
          </div>
        ) : (
          <p className="font-mono text-xs text-amber-400">
            No active stealth keys found for current chain ({chain}). Connect wallet or derive keys
            on Receive page to export a kit.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Encryption Passphrase (Min 8 Characters)
          </label>
          <input
            type="password"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            placeholder="Enter a strong passphrase"
            className="h-11 w-full border border-outline-variant bg-surface px-3.5 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
          />

          {/* Strength Meter */}
          {exportPassphrase.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                <span className="text-outline">Passphrase Strength:</span>
                <span
                  className={
                    passphraseStrength.score <= 1
                      ? 'text-error font-bold'
                      : passphraseStrength.score === 2
                        ? 'text-amber-400 font-bold'
                        : 'text-tertiary font-bold'
                  }
                >
                  {passphraseStrength.label} {passphraseStrength.score < 1 && '(Weak - <8 chars)'}
                </span>
              </div>
              <div className="flex h-1.5 w-full gap-1 bg-surface-bright">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-full flex-1 transition-colors ${
                      step <= passphraseStrength.score
                        ? passphraseStrength.score <= 1
                          ? 'bg-error'
                          : passphraseStrength.score === 2
                            ? 'bg-amber-400'
                            : 'bg-tertiary'
                        : 'bg-outline-variant/30'
                    }`}
                  />
                ))}
              </div>
              {!passphraseStrength.valid && (
                <span className="font-mono text-[10px] text-error">
                  Passphrase must be at least 8 characters long to export.
                </span>
              )}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-on-surface">
          <input
            type="checkbox"
            checked={includeSpendingScalar}
            onChange={(e) => setIncludeSpendingScalar(e.target.checked)}
            className="h-4 w-4 rounded-none border-outline-variant bg-surface text-primary focus:ring-0"
          />
          <span>Include spending scalar in kit (allows spend authority)</span>
        </label>

        <button
          onClick={handleExportKit}
          disabled={!activeMetaAddress || !activeKeys || !passphraseStrength.valid || isExporting}
          className="h-11 bg-primary px-5 font-heading text-xs font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
        >
          {isExporting ? 'Exporting...' : 'Export Recovery Kit'}
        </button>

        {exportMessage && (
          <p
            className={`font-mono text-xs ${
              exportMessage.type === 'success' ? 'text-tertiary' : 'text-error'
            }`}
          >
            {exportMessage.text}
          </p>
        )}
      </fieldset>

      {/* Restore Recovery Kit */}
      <fieldset className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          Restore Recovery Kit
        </legend>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          Restore a passphrase-encrypted JSON recovery kit on a fresh browser to unlock receive-only
          scanning mode without needing the original wallet.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-10 border border-outline-variant bg-surface px-4 font-heading text-xs font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            {selectedFileName ? 'Change Kit File' : 'Select Recovery Kit (.json)'}
          </button>
          {selectedFileName && (
            <span className="truncate font-mono text-xs text-on-surface-variant">
              {selectedFileName}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Decryption Passphrase
          </label>
          <input
            type="password"
            value={restorePassphrase}
            onChange={(e) => setRestorePassphrase(e.target.value)}
            placeholder="Enter passphrase used at export"
            className="h-11 w-full border border-outline-variant bg-surface px-3.5 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
          />
        </div>

        <button
          onClick={handleRestoreKit}
          disabled={!selectedFileContent || !restorePassphrase || isRestoring}
          className="h-11 bg-primary px-5 font-heading text-xs font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
        >
          {isRestoring ? 'Decrypting & Restoring...' : 'Restore Recovery Kit'}
        </button>

        {restoreMessage && (
          <p
            className={`font-mono text-xs ${
              restoreMessage.type === 'success' ? 'text-tertiary' : 'text-error'
            }`}
          >
            {restoreMessage.text}
          </p>
        )}
      </fieldset>

      {/* Scanning Strategy */}
      <fieldset className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          {t('scanStrategy.title')}
        </legend>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          {t('scanStrategy.description')}
        </p>

        <div className="group relative inline-flex w-fit items-center gap-1.5">
          <span
            tabIndex={0}
            role="note"
            aria-label={t('scanStrategy.tooltip')}
            className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-outline-variant font-mono text-[9px] text-outline"
          >
            i
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Privacy note
          </span>
          <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-72 border border-outline-variant bg-surface-container p-3 font-body text-xs leading-relaxed text-on-surface-variant opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            {t('scanStrategy.tooltip')}
          </div>
        </div>

        {scanStrategyOptions.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 border border-outline-variant p-3 transition-colors hover:bg-surface-bright"
          >
            <input
              type="radio"
              name="scan-strategy"
              value={option.value}
              checked={strategy === option.value}
              onChange={() => setStrategy(option.value)}
              className="mt-1 accent-[var(--color-tertiary)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-heading text-sm font-semibold text-on-surface">
                {option.label}
              </span>
              <span className="font-body text-xs text-on-surface-variant">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Appearance Preferences */}
      <fieldset className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          Appearance
        </legend>
        {preferences.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 border border-outline-variant p-3 transition-colors hover:bg-surface-bright"
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={preference === option.value}
              onChange={() => setThemePreference(option.value)}
              className="mt-1 accent-[var(--color-tertiary)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-heading text-sm font-semibold text-on-surface">
                {option.label}
              </span>
              <span className="font-body text-xs text-on-surface-variant">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Scanning Strategy Preferences */}
      <fieldset className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          {t('stellar.scanningStrategy')}
        </legend>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          {t('stellar.scanningStrategyDescription')}
        </p>
        {scanningStrategies.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 border border-outline-variant p-3 transition-colors hover:bg-surface-bright"
          >
            <input
              type="radio"
              name="scanning-strategy"
              value={option.value}
              checked={scanningStrategy === option.value}
              onChange={() => setScanningStrategy(option.value)}
              className="mt-1 accent-[var(--color-tertiary)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-heading text-sm font-semibold text-on-surface">
                {t(option.labelKey)}
              </span>
              <span className="font-body text-xs text-on-surface-variant">
                {t(option.descriptionKey)}
              </span>
              <span className="font-mono text-[10px] text-outline">{t(option.tooltipKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Web Push Notifications */}
      <fieldset className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
        <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
          {t('stellar.webPush')}
        </legend>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          {t('stellar.webPushDescription')}
        </p>

        {/* Support Check */}
        {!pushState.supported && (
          <div className="border border-error/40 bg-error/10 p-3">
            <p className="font-mono text-xs text-error">{t('stellar.webPushNotSupported')}</p>
          </div>
        )}

        {/* Permission Status */}
        {pushState.supported && pushState.permission === 'denied' && (
          <div className="border border-error/40 bg-error/10 p-3">
            <p className="font-mono text-xs text-error">{t('stellar.webPushPermissionDenied')}</p>
          </div>
        )}

        {/* Relay URL Configuration */}
        {pushState.supported && pushState.permission !== 'denied' && (
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('stellar.relayUrl')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={relayUrlInput}
                onChange={(e) => setRelayUrlInput(e.target.value)}
                placeholder="https://relay.wraith-protocol.dev/api"
                className="h-11 flex-1 border border-outline-variant bg-surface px-3.5 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handleUpdateRelayUrl}
                disabled={relayUrlInput === pushState.relayUrl}
                className="h-11 border border-outline-variant bg-surface px-4 font-heading text-xs font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
              >
                {t('common.update')}
              </button>
              <button
                onClick={handleTestRelay}
                disabled={isTestingRelay}
                className="h-11 border border-outline-variant bg-surface px-4 font-heading text-xs font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
              >
                {isTestingRelay ? t('stellar.testing') : t('common.test')}
              </button>
            </div>
            <p className="font-mono text-[10px] text-on-surface-variant">
              {t('stellar.selfHostableRelay', { defaultUrl: DEFAULT_RELAY_URL })}
            </p>
          </div>
        )}

        {/* Subscription Status */}
        {pushState.supported && pushState.permission !== 'denied' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('stellar.status')}
              </span>
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                  pushState.subscribed ? 'text-tertiary' : 'text-outline'
                }`}
              >
                {pushState.subscribed ? t('stellar.subscribed') : t('stellar.notSubscribed')}
              </span>
            </div>
            {pushState.subscribed && (
              <div className="border border-tertiary/40 bg-tertiary/10 p-3">
                <p className="font-mono text-xs text-tertiary">✓ {t('stellar.subscribedNotice')}</p>
              </div>
            )}
          </div>
        )}

        {/* Subscribe/Unsubscribe Buttons */}
        {pushState.supported && pushState.permission !== 'denied' && (
          <div className="flex gap-2">
            {!pushState.subscribed ? (
              <button
                onClick={handleSubscribe}
                disabled={!activeMetaAddress || isSubscribing}
                className="h-11 flex-1 bg-primary px-5 font-heading text-xs font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
              >
                {isSubscribing ? t('stellar.subscribing') : t('stellar.subscribeToAlerts')}
              </button>
            ) : (
              <button
                onClick={handleUnsubscribe}
                disabled={isUnsubscribing}
                className="h-11 flex-1 border border-error/40 bg-surface px-5 font-heading text-xs font-semibold uppercase tracking-widest text-error transition-colors hover:bg-error/10 disabled:opacity-30"
              >
                {isUnsubscribing ? t('stellar.unsubscribing') : t('stellar.unsubscribe')}
              </button>
            )}
          </div>
        )}

        {/* Privacy Notice */}
        {pushState.supported && pushState.permission !== 'denied' && (
          <div className="border border-outline-variant/60 bg-surface/50 p-3 font-mono text-xs text-on-surface-variant">
            <span className="font-semibold text-on-surface">{t('stellar.privacyNotice')}: </span>
            {t('stellar.privacyNoticeText')}
          </div>
        )}

        {/* Push Messages */}
        {pushMessage && (
          <p
            className={`font-mono text-xs ${
              pushMessage.type === 'success' ? 'text-tertiary' : 'text-error'
            }`}
          >
            {pushMessage.text}
          </p>
        )}
      </fieldset>
    </section>
  );
}
