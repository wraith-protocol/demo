import { useChain } from '@/context/ChainContext';
import { HorizenSend } from '@/components/HorizenSend';
import { StellarSend } from '@/components/StellarSend';

export default function Send() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return <StellarSend />;
  }

  return <HorizenSend />;
}
