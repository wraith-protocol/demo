import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { StellarWalletContext } from '@/context/StellarWalletContext';
import type { StealthKeys as EVMStealthKeys } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys as SolanaStealthKeys } from '@wraith-protocol/sdk/chains/solana';
import type { StealthKeys as CKBStealthKeys } from '@wraith-protocol/sdk/chains/ckb';
import { hexToBytes, type RecoveryKitData } from '@/lib/stellar/recoveryKit';
import { importLabels } from '@/lib/stealthLabels';

interface StealthKeysContextValue {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;
  isRecoveryMode: boolean;
  isReadOnly: boolean;
  setIsRecoveryMode: (active: boolean) => void;
  setIsReadOnly: (readOnly: boolean) => void;
  restoreFromRecoveryKit: (kitData: RecoveryKitData) => void;
  exitRecoveryMode: () => void;
  setEvmKeys: (keys: EVMStealthKeys) => void;
  setEvmMetaAddress: (metaAddress: string) => void;
  setStellarKeys: (keys: StellarStealthKeys) => void;
  setStellarMetaAddress: (metaAddress: string) => void;
  setSolanaKeys: (keys: SolanaStealthKeys) => void;
  setSolanaMetaAddress: (metaAddress: string) => void;
  setCkbKeys: (keys: CKBStealthKeys) => void;
  setCkbMetaAddress: (metaAddress: string) => void;
  clearEvm: () => void;
  clearStellar: () => void;
  clearSolana: () => void;
  clearCkb: () => void;
}

export const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

// Subscribes clearStellar to StellarWalletContext's disconnect listeners.
// Rendered inside StealthKeysProvider so it can consume both contexts.
function StealthKeysCleaner({ clearStellar }: { clearStellar: () => void }) {
  const stellar = useContext(StellarWalletContext);
  const subscribeToDisconnect = stellar?.subscribeToDisconnect;
  useEffect(() => {
    if (!subscribeToDisconnect) return;
    return subscribeToDisconnect(clearStellar);
  }, [subscribeToDisconnect, clearStellar]);
  return null;
}

export function StealthKeysProvider({ children }: { children: React.ReactNode }) {
  const [evmKeys, setEvmKeys] = useState<EVMStealthKeys | null>(null);
  const [evmMetaAddress, setEvmMetaAddress] = useState<string | null>(null);
  const [stellarKeys, setStellarKeys] = useState<StellarStealthKeys | null>(null);
  const [stellarMetaAddress, setStellarMetaAddress] = useState<string | null>(null);
  const [solanaKeys, setSolanaKeys] = useState<SolanaStealthKeys | null>(null);
  const [solanaMetaAddress, setSolanaMetaAddress] = useState<string | null>(null);
  const [ckbKeys, setCkbKeys] = useState<CKBStealthKeys | null>(null);
  const [ckbMetaAddress, setCkbMetaAddress] = useState<string | null>(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);

  const clearEvm = useCallback(() => {
    if (isRecoveryMode) return;
    setEvmKeys(null);
    setEvmMetaAddress(null);
  }, [isRecoveryMode]);

  const clearStellar = useCallback(() => {
    if (isRecoveryMode) return;
    setStellarKeys(null);
    setStellarMetaAddress(null);
  }, [isRecoveryMode]);

  const clearSolana = useCallback(() => {
    if (isRecoveryMode) return;
    setSolanaKeys(null);
    setSolanaMetaAddress(null);
  }, [isRecoveryMode]);

  const clearCkb = useCallback(() => {
    if (isRecoveryMode) return;
    setCkbKeys(null);
    setCkbMetaAddress(null);
  }, [isRecoveryMode]);

  const exitRecoveryMode = useCallback(() => {
    setIsRecoveryMode(false);
    setIsReadOnly(false);
    setEvmKeys(null);
    setEvmMetaAddress(null);
    setStellarKeys(null);
    setStellarMetaAddress(null);
    setSolanaKeys(null);
    setSolanaMetaAddress(null);
    setCkbKeys(null);
    setCkbMetaAddress(null);
  }, []);

  const restoreFromRecoveryKit = useCallback((kitData: RecoveryKitData) => {
    setIsRecoveryMode(true);
    setIsReadOnly(!kitData.spendingScalarHex);

    const viewingKey = kitData.viewingScalarHex
      ? hexToBytes(kitData.viewingScalarHex)
      : new Uint8Array(32);
    const spendingPubKey = kitData.spendingPubKeyHex
      ? hexToBytes(kitData.spendingPubKeyHex)
      : new Uint8Array(32);
    const viewingPubKey = kitData.viewingPubKeyHex
      ? hexToBytes(kitData.viewingPubKeyHex)
      : new Uint8Array(32);
    const spendingScalar = kitData.spendingScalarHex
      ? BigInt(
          kitData.spendingScalarHex.startsWith('0x')
            ? kitData.spendingScalarHex
            : `0x${kitData.spendingScalarHex}`,
        )
      : undefined;

    const chain = kitData.chain?.toLowerCase() || '';

    if (chain === 'stellar' || kitData.metaAddress?.startsWith('st:xlm:')) {
      const keys: any = {
        viewingKey,
        viewingScalar: viewingKey,
        spendingKey: spendingPubKey,
        spendingPubKey,
        viewingPubKey,
        spendingScalar,
      };
      setStellarKeys(keys as StellarStealthKeys);
      setStellarMetaAddress(kitData.metaAddress);
    } else if (chain === 'horizen' || kitData.metaAddress?.startsWith('st:eth:')) {
      const keys: any = {
        viewingKey: kitData.viewingScalarHex,
        spendingPubKey: kitData.spendingPubKeyHex || '',
        viewingPubKey: kitData.viewingPubKeyHex || '',
        spendingScalar: kitData.spendingScalarHex || '',
      };
      setEvmKeys(keys as EVMStealthKeys);
      setEvmMetaAddress(kitData.metaAddress);
    } else if (chain === 'solana' || kitData.metaAddress?.startsWith('st:sol:')) {
      const keys: any = {
        viewingKey,
        viewingScalar: viewingKey,
        spendingKey: spendingPubKey,
        spendingPubKey,
        viewingPubKey,
        spendingScalar,
      };
      setSolanaKeys(keys as SolanaStealthKeys);
      setSolanaMetaAddress(kitData.metaAddress);
    } else if (chain === 'ckb' || kitData.metaAddress?.startsWith('st:ckb:')) {
      const keys: any = {
        viewingKey: kitData.viewingScalarHex,
        spendingPubKey: kitData.spendingPubKeyHex || '',
        viewingPubKey: kitData.viewingPubKeyHex || '',
        spendingScalar: kitData.spendingScalarHex || '',
      };
      setCkbKeys(keys as CKBStealthKeys);
      setCkbMetaAddress(kitData.metaAddress);
    } else {
      const keys: any = {
        viewingKey,
        viewingScalar: viewingKey,
        spendingKey: spendingPubKey,
        spendingPubKey,
        viewingPubKey,
        spendingScalar,
      };
      setStellarKeys(keys as StellarStealthKeys);
      setStellarMetaAddress(kitData.metaAddress);
    }

    if (kitData.labels) {
      try {
        importLabels(kitData.metaAddress, JSON.stringify(kitData.labels), true);
      } catch {
        // Labels restore optional
      }
    }
  }, []);

  return (
    <StealthKeysContext.Provider
      value={{
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
        setIsRecoveryMode,
        setIsReadOnly,
        restoreFromRecoveryKit,
        exitRecoveryMode,
        setEvmKeys,
        setEvmMetaAddress,
        setStellarKeys,
        setStellarMetaAddress,
        setSolanaKeys,
        setSolanaMetaAddress,
        setCkbKeys,
        setCkbMetaAddress,
        clearEvm,
        clearStellar,
        clearSolana,
        clearCkb,
      }}
    >
      <StealthKeysCleaner clearStellar={clearStellar} />
      {children}
    </StealthKeysContext.Provider>
  );
}

export function useStealthKeys() {
  const ctx = useContext(StealthKeysContext);
  if (!ctx) throw new Error('useStealthKeys must be used within StealthKeysProvider');
  return ctx;
}
