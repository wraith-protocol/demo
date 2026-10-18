import { lazy, Suspense, useEffect } from 'react';
import { useChain } from '@/context/ChainContext';
import { RouteFallback } from '@/components/RouteFallback';
import { OfflineQueuePanel } from '@/components/OfflineQueuePanel';
import { trackPageView } from '@/lib/telemetry';

// Each chain pulls in its own wallet SDK (wagmi/RainbowKit, Freighter +
// @stellar/stellar-sdk, @solana/wallet-adapter, @ckb-ccc). Only one chain is
// ever rendered at a time, so load just that one instead of bundling all
// four wallet stacks into the initial /send chunk.
const HorizenSend = lazy(() =>
  import('@/components/HorizenSend').then((m) => ({ default: m.HorizenSend })),
);
const StellarSend = lazy(() =>
  import('@/components/StellarSend').then((m) => ({ default: m.StellarSend })),
);
const SolanaSend = lazy(() =>
  import('@/components/SolanaSend').then((m) => ({ default: m.SolanaSend })),
);
const CkbSend = lazy(() => import('@/components/CkbSend').then((m) => ({ default: m.CkbSend })));

export default function Send() {
  const { chain } = useChain();

  useEffect(() => {
    trackPageView('/send');
  }, []);

  // Wave 9 (#184): review surface for work queued while offline. Queued
  // payment intents land here for explicit review + signing after reconnect.
  const queuePanel = <OfflineQueuePanel />;

  if (chain === 'stellar') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <StellarSend />
        {queuePanel}
      </Suspense>
    );
  }
  if (chain === 'solana') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <SolanaSend />
        {queuePanel}
      </Suspense>
    );
  }
  if (chain === 'ckb') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <CkbSend />
        {queuePanel}
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <HorizenSend />
      {queuePanel}
    </Suspense>
  );
}
