import { useChain } from '@/context/ChainContext';
import { StellarVault } from '@/components/StellarVault';

export default function Vault() {
  const { chain } = useChain();

  // Non-Stellar vault UIs are not yet implemented; fall back to Stellar.
  if (chain === 'stellar') return <StellarVault />;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="font-heading text-sm uppercase tracking-widest text-outline">Vault preview</p>
      <p className="max-w-md font-body text-sm text-on-surface-variant">
        The stealth vault UI is only available on Stellar right now. Switch the chain selector to
        Stellar to try it out.
      </p>
    </div>
  );
}
