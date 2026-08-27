import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_SCAN_STRATEGY,
  SCAN_STRATEGIES,
  type ScanStrategy,
} from '@/workers/stellarScanDispatch';

export type { ScanStrategy };
export { SCAN_STRATEGIES, DEFAULT_SCAN_STRATEGY };

interface ScanStrategyContextType {
  strategy: ScanStrategy;
  setStrategy: (strategy: ScanStrategy) => void;
}

const ScanStrategyContext = createContext<ScanStrategyContextType | undefined>(undefined);

const SCAN_STRATEGY_STORAGE_KEY = 'wraith-scan-strategy';

function isScanStrategy(value: string | null): value is ScanStrategy {
  return value !== null && (SCAN_STRATEGIES as string[]).includes(value);
}

function getInitialStrategy(): ScanStrategy {
  if (typeof window === 'undefined') return DEFAULT_SCAN_STRATEGY;
  const stored = localStorage.getItem(SCAN_STRATEGY_STORAGE_KEY);
  return isScanStrategy(stored) ? stored : DEFAULT_SCAN_STRATEGY;
}

export function ScanStrategyProvider({ children }: { children: ReactNode }) {
  const [strategy, setStrategy] = useState<ScanStrategy>(getInitialStrategy);

  useEffect(() => {
    localStorage.setItem(SCAN_STRATEGY_STORAGE_KEY, strategy);
  }, [strategy]);

  return (
    <ScanStrategyContext.Provider value={{ strategy, setStrategy }}>
      {children}
    </ScanStrategyContext.Provider>
  );
}

export function useScanStrategy() {
  const context = useContext(ScanStrategyContext);
  if (context === undefined) {
    throw new Error('useScanStrategy must be used within a ScanStrategyProvider');
  }
  return context;
}
