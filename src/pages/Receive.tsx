import { useChain } from '@/context/ChainContext';

export default function Receive() {
  const { chain } = useChain();

  return (
    <section>
      <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
        Receive
      </h1>
      <p className="text-sm text-on-surface-variant">
        Scan for stealth payments on {chain === 'horizen' ? 'Horizen' : 'Stellar'}.
      </p>
    </section>
  );
}
