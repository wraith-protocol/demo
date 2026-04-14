import { createContext, useContext, useState, useCallback } from 'react';

export type Chain = 'horizen' | 'stellar';

interface ChainContextValue {
  chain: Chain;
  setChain: (chain: Chain) => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chain, setChainState] = useState<Chain>('horizen');

  const setChain = useCallback((c: Chain) => {
    setChainState(c);
  }, []);

  return <ChainContext.Provider value={{ chain, setChain }}>{children}</ChainContext.Provider>;
}

export function useChain() {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error('useChain must be used within ChainProvider');
  return ctx;
}
