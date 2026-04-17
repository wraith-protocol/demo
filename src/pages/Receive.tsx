import { useChain } from '@/context/ChainContext';
import { HorizenReceive } from '@/components/HorizenReceive';
import { StellarReceive } from '@/components/StellarReceive';
import { SolanaReceive } from '@/components/SolanaReceive';
import { CkbReceive } from '@/components/CkbReceive';

export default function Receive() {
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarReceive />;
  if (chain === 'solana') return <SolanaReceive />;
  if (chain === 'ckb') return <CkbReceive />;
  return <HorizenReceive />;
}
