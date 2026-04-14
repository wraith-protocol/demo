import { createContext, useContext, useState, useCallback } from 'react';
import type { StealthKeys as EVMStealthKeys } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

interface StealthKeysContextValue {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  setEvmKeys: (keys: EVMStealthKeys) => void;
  setEvmMetaAddress: (metaAddress: string) => void;
  setStellarKeys: (keys: StellarStealthKeys) => void;
  setStellarMetaAddress: (metaAddress: string) => void;
  clearEvm: () => void;
  clearStellar: () => void;
}

const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

export function StealthKeysProvider({ children }: { children: React.ReactNode }) {
  const [evmKeys, setEvmKeys] = useState<EVMStealthKeys | null>(null);
  const [evmMetaAddress, setEvmMetaAddress] = useState<string | null>(null);
  const [stellarKeys, setStellarKeys] = useState<StellarStealthKeys | null>(null);
  const [stellarMetaAddress, setStellarMetaAddress] = useState<string | null>(null);

  const clearEvm = useCallback(() => {
    setEvmKeys(null);
    setEvmMetaAddress(null);
  }, []);
  const clearStellar = useCallback(() => {
    setStellarKeys(null);
    setStellarMetaAddress(null);
  }, []);

  return (
    <StealthKeysContext.Provider
      value={{
        evmKeys,
        evmMetaAddress,
        stellarKeys,
        stellarMetaAddress,
        setEvmKeys,
        setEvmMetaAddress,
        setStellarKeys,
        setStellarMetaAddress,
        clearEvm,
        clearStellar,
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
