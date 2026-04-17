import { createContext, useContext, useState, useCallback } from 'react';
import type { StealthKeys as EVMStealthKeys } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys as SolanaStealthKeys } from '@/lib/solana-stealth';
import type { StealthKeys as CKBStealthKeys } from '@/lib/ckb-stealth';

interface StealthKeysContextValue {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;
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

const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

export function StealthKeysProvider({ children }: { children: React.ReactNode }) {
  const [evmKeys, setEvmKeys] = useState<EVMStealthKeys | null>(null);
  const [evmMetaAddress, setEvmMetaAddress] = useState<string | null>(null);
  const [stellarKeys, setStellarKeys] = useState<StellarStealthKeys | null>(null);
  const [stellarMetaAddress, setStellarMetaAddress] = useState<string | null>(null);
  const [solanaKeys, setSolanaKeys] = useState<SolanaStealthKeys | null>(null);
  const [solanaMetaAddress, setSolanaMetaAddress] = useState<string | null>(null);
  const [ckbKeys, setCkbKeys] = useState<CKBStealthKeys | null>(null);
  const [ckbMetaAddress, setCkbMetaAddress] = useState<string | null>(null);

  const clearEvm = useCallback(() => {
    setEvmKeys(null);
    setEvmMetaAddress(null);
  }, []);
  const clearStellar = useCallback(() => {
    setStellarKeys(null);
    setStellarMetaAddress(null);
  }, []);
  const clearSolana = useCallback(() => {
    setSolanaKeys(null);
    setSolanaMetaAddress(null);
  }, []);
  const clearCkb = useCallback(() => {
    setCkbKeys(null);
    setCkbMetaAddress(null);
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
      {children}
    </StealthKeysContext.Provider>
  );
}

export function useStealthKeys() {
  const ctx = useContext(StealthKeysContext);
  if (!ctx) throw new Error('useStealthKeys must be used within StealthKeysProvider');
  return ctx;
}
