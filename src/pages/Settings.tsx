import { useState, useRef } from 'react';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useChain } from '@/context/ChainContext';
import { getLabels } from '@/lib/stealthLabels';
import {
  exportRecoveryKit,
  importRecoveryKit,
  validatePassphrase,
  generateRecoveryFilename,
  bytesToHex,
} from '@/lib/stellar/recoveryKit';

const preferences: Array<{ value: ThemePreference; label: string; description: string }> = [
  {
    value: 'system',
    label: 'System default',
    description: 'Follow your operating system preference.',
  },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

export default function Settings() {
  const { preference, setThemePreference } = useTheme();
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
    </section>
  );
}
