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
  const [evmKeys, setEvmKeysState] = useState<EVMStealthKeys | null>(null);
  const [evmMetaAddress, setEvmMetaAddressState] = useState<string | null>(null);
  const [stellarKeys, setStellarKeysState] = useState<StellarStealthKeys | null>(null);
  const [stellarMetaAddress, setStellarMetaAddressState] = useState<string | null>(null);

  const setEvmKeys = useCallback((k: EVMStealthKeys) => setEvmKeysState(k), []);
  const setEvmMetaAddress = useCallback((m: string) => setEvmMetaAddressState(m), []);
  const setStellarKeys = useCallback((k: StellarStealthKeys) => setStellarKeysState(k), []);
  const setStellarMetaAddress = useCallback((m: string) => setStellarMetaAddressState(m), []);
  const clearEvm = useCallback(() => {
    setEvmKeysState(null);
    setEvmMetaAddressState(null);
  }, []);
  const clearStellar = useCallback(() => {
    setStellarKeysState(null);
    setStellarMetaAddressState(null);
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
