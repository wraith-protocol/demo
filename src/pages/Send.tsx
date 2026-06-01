import { useChain } from '@/context/ChainContext';
import { HorizenSend } from '@/components/HorizenSend';
import { StellarSend } from '@/components/StellarSend';
import { SolanaSend } from '@/components/SolanaSend';
import { CkbSend } from '@/components/CkbSend';
import { WrongNetworkBanner } from '@/components/WrongNetworkBanner';

export default function Send() {
  const { chain } = useChain();

  return (
    <div>
      <WrongNetworkBanner />
      {chain === 'stellar' ? <StellarSend /> : chain === 'solana' ? <SolanaSend /> : chain === 'ckb' ? <CkbSend /> : <HorizenSend />}
    </div>
  );
}
