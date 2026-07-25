import { useEffect } from 'react';
import { useChain } from '@/context/ChainContext';
import { HorizenReceive } from '@/components/HorizenReceive';
import { StellarReceive } from '@/components/StellarReceive';
import { SolanaReceive } from '@/components/SolanaReceive';
import { CkbReceive } from '@/components/CkbReceive';
import { trackPageView } from '@/lib/telemetry';

export default function Receive() {
  const { chain } = useChain();

  useEffect(() => {
    trackPageView('/receive');
  }, []);

  if (chain === 'stellar') return <StellarReceive />;
  if (chain === 'solana') return <SolanaReceive />;
  if (chain === 'ckb') return <CkbReceive />;
  return <HorizenReceive />;
}
