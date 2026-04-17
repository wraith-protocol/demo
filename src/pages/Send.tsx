import { useChain } from '@/context/ChainContext';
import { HorizenSend } from '@/components/HorizenSend';
import { StellarSend } from '@/components/StellarSend';
import { SolanaSend } from '@/components/SolanaSend';
import { CkbSend } from '@/components/CkbSend';

export default function Send() {
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarSend />;
  if (chain === 'solana') return <SolanaSend />;
  if (chain === 'ckb') return <CkbSend />;
  return <HorizenSend />;
}
