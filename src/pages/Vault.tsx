import { useChain } from '@/context/ChainContext';
import { StellarVault } from '@/components/StellarVault';
import { SolanaVault } from '@/components/SolanaVault';
import { HorizenVault } from '@/components/HorizenVault';
import { CkbVault } from '@/components/CkbVault';

export default function Vault() {
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarVault />;
  if (chain === 'solana') return <SolanaVault />;
  if (chain === 'ckb') return <CkbVault />;
  return <HorizenVault />;
}
