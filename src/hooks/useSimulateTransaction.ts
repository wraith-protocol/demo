import { useState, useEffect, useRef, useCallback } from 'react';
import type { SimulationResult } from '@/lib/soroban';

interface UseSimulateTransactionOptions {
  debounceMs?: number;
  enabled?: boolean;
}

interface UseSimulateTransactionReturn {
  result: SimulationResult | null;
  isSimulating: boolean;
  simulate: () => void;
  reset: () => void;
}

export function useSimulateTransaction(
  buildTx: (() => Promise<import('@stellar/stellar-sdk').Transaction>) | null,
  opts: UseSimulateTransactionOptions = {},
): UseSimulateTransactionReturn {
  const { debounceMs = 500, enabled = true } = opts;
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0);
  const sorobanRef = useRef<typeof import('@/lib/soroban') | null>(null);

  const reset = useCallback(() => {
    setResult(null);
    setIsSimulating(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current++;
  }, []);

  const runSimulation = useCallback(async () => {
    if (!buildTx || !enabled) return;

    const simId = ++abortRef.current;
    setIsSimulating(true);

    try {
      if (!sorobanRef.current) {
        sorobanRef.current = await import('@/lib/soroban');
      }

      const tx = await buildTx();
      if (simId !== abortRef.current) return;
      const simResult = await sorobanRef.current.simulateStellarTransaction(tx);
      if (simId !== abortRef.current) return;
      setResult(simResult);
    } catch (err) {
      if (simId !== abortRef.current) return;
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Simulation failed',
        isNetworkError: false,
      });
    } finally {
      if (simId === abortRef.current) {
        setIsSimulating(false);
      }
    }
  }, [buildTx, enabled]);

  const simulate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runSimulation, debounceMs);
  }, [runSimulation, debounceMs]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current++;
    };
  }, []);

  return { result, isSimulating, simulate, reset };
}
