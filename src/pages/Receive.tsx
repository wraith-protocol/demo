import { useChain } from '@/context/ChainContext';
import { HorizenReceive } from '@/components/HorizenReceive';
import { StellarReceive } from '@/components/StellarReceive';
import { SolanaReceive } from '@/components/SolanaReceive';
import { CkbReceive } from '@/components/CkbReceive';
import { WrongNetworkBanner } from '@/components/WrongNetworkBanner';

export default function Receive() {
  const { chain } = useChain();

  return (
    <div>
      <WrongNetworkBanner />
      {chain === 'stellar' ? <StellarReceive /> : chain === 'solana' ? <SolanaReceive /> : chain === 'ckb' ? <CkbReceive /> : <HorizenReceive />}
    </div>
  );
}
