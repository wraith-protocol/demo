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
  const [strategyState, setStrategyState] = useState<ScanStrategy>(getInitialStrategy);

  const setStrategy = (newStrategy: ScanStrategy) => {
    localStorage.setItem(SCAN_STRATEGY_STORAGE_KEY, newStrategy);
    setStrategyState(newStrategy);
  };

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SCAN_STRATEGY_STORAGE_KEY) {
        if (e.newValue && isScanStrategy(e.newValue)) {
          setStrategyState(e.newValue);
        } else {
          setStrategyState(DEFAULT_SCAN_STRATEGY);
        }
      } else if (e.key === null) {
        setStrategyState(DEFAULT_SCAN_STRATEGY);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <ScanStrategyContext.Provider value={{ strategy: strategyState, setStrategy }}>
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
