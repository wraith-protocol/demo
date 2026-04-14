import { useChain } from '@/context/ChainContext';
import { HorizenReceive } from '@/components/HorizenReceive';
import { StellarReceive } from '@/components/StellarReceive';

export default function Receive() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return <StellarReceive />;
  }

  return <HorizenReceive />;
}
