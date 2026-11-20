import { lazy, Suspense, useEffect } from 'react';
import { useChain } from '@/context/ChainContext';
import { RouteFallback } from '@/components/RouteFallback';
import { trackPageView } from '@/lib/telemetry';

// Same rationale as pages/Send.tsx: each chain's wallet SDK (and, for
// Stellar, the scanner worker it spins up) only needs to load for the
// chain the user actually picked.
const HorizenReceive = lazy(() =>
  import('@/components/HorizenReceive').then((m) => ({ default: m.HorizenReceive })),
);
const StellarReceive = lazy(() =>
  import('@/components/StellarReceive').then((m) => ({ default: m.StellarReceive })),
);
const SolanaReceive = lazy(() =>
  import('@/components/SolanaReceive').then((m) => ({ default: m.SolanaReceive })),
);
const CkbReceive = lazy(() =>
  import('@/components/CkbReceive').then((m) => ({ default: m.CkbReceive })),
);

export default function Receive() {
  const { chain } = useChain();

  useEffect(() => {
    trackPageView('/receive');
  }, []);

  if (chain === 'stellar') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <StellarReceive />
      </Suspense>
    );
  }
  if (chain === 'solana') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <SolanaReceive />
      </Suspense>
    );
  }
  if (chain === 'ckb') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <CkbReceive />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <HorizenReceive />
    </Suspense>
  );
}
