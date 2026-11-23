import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeStealthMetaAddress, type StealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import { KeyVault } from '@/vault';

export type VaultBusy = 'idle' | 'unlocking' | 'saving' | 'locking';

interface UseStellarVaultOptions {
  stellarKeys: StealthKeys | null;
  setStellarKeys: (keys: StealthKeys) => void;
  setStellarMetaAddress: (metaAddress: string) => void;
}

export interface StellarVaultState {
  passphrase: string;
  message: string | null;
  busy: VaultBusy;
  supported: boolean;
  setPassphrase: (value: string) => void;
  save: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => Promise<void>;
}

export function useStellarVault({
  stellarKeys,
  setStellarKeys,
  setStellarMetaAddress,
}: UseStellarVaultOptions): StellarVaultState {
  const [passphrase, setPassphrase] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<VaultBusy>('idle');
  const [supported, setSupported] = useState(false);
  const vaultRef = useRef<KeyVault | null>(null);

  useEffect(() => {
    try {
      vaultRef.current = new KeyVault({ idleTimeoutMs: 2 * 60 * 1000, lockOnBlur: true });
      setSupported(true);
    } catch {
      vaultRef.current = null;
      setSupported(false);
    }
    return () => {
      void vaultRef.current?.lock();
    };
  }, []);

  const save = useCallback(async () => {
    if (!stellarKeys) return;
    if (!vaultRef.current) {
      setMessage('Browser vault is unavailable in this environment.');
      return;
    }
    if (!passphrase) {
      setMessage('Enter a passphrase to save the keys.');
      return;
    }

    setBusy('saving');
    setMessage(null);
    try {
      await vaultRef.current.unlock(passphrase);
      await vaultRef.current.put('stellar', stellarKeys);
      setMessage('Keys saved in the browser vault.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save vault keys');
    } finally {
      setBusy('idle');
    }
  }, [passphrase, stellarKeys]);

  const unlock = useCallback(async () => {
    if (!vaultRef.current) {
      setMessage('Browser vault is unavailable in this environment.');
      return;
    }
    if (!passphrase) {
      setMessage('Enter a passphrase to unlock the vault.');
      return;
    }

    setBusy('unlocking');
    setMessage(null);
    try {
      await vaultRef.current.unlock(passphrase);
      const savedKeys = await vaultRef.current.get<StealthKeys>('stellar');
      if (!savedKeys) throw new Error('No Stellar keys found in the vault');

      setStellarKeys(savedKeys);
      setStellarMetaAddress(
        encodeStealthMetaAddress(savedKeys.spendingPubKey, savedKeys.viewingPubKey),
      );
      setMessage('Keys restored from the browser vault.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to unlock vault');
    } finally {
      setBusy('idle');
    }
  }, [passphrase, setStellarKeys, setStellarMetaAddress]);

  const lock = useCallback(async () => {
    if (!vaultRef.current) return;
    setBusy('locking');
    setMessage(null);
    try {
      await vaultRef.current.lock();
      setMessage('Vault locked.');
    } finally {
      setBusy('idle');
    }
  }, []);

  return { passphrase, message, busy, supported, setPassphrase, save, unlock, lock };
}
