import { useChain } from '@/context/ChainContext';
import { StellarHistory } from '@/components/StellarHistory';

export default function History() {
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarHistory />;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          History
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Transaction history for {chain.charAt(0).toUpperCase() + chain.slice(1)} is not yet
          implemented.
        </p>
      </section>
    </div>
  );
}
