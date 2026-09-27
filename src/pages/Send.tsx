import { useEffect } from 'react';
import { useChain } from '@/context/ChainContext';
import { HorizenSend } from '@/components/HorizenSend';
import { StellarSend } from '@/components/StellarSend';
import { SolanaSend } from '@/components/SolanaSend';
import { CkbSend } from '@/components/CkbSend';
import { OfflineQueuePanel } from '@/components/OfflineQueuePanel';
import { trackPageView } from '@/lib/telemetry';

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
      <>
        <StellarSend />
        {queuePanel}
      </>
    );
  }
  if (chain === 'solana') {
    return (
      <>
        <SolanaSend />
        {queuePanel}
      </>
    );
  }
  if (chain === 'ckb') {
    return (
      <>
        <CkbSend />
        {queuePanel}
      </>
    );
  }
  return (
    <>
      <HorizenSend />
      {queuePanel}
    </>
  );
}
