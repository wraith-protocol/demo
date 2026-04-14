import { useChain } from '@/context/ChainContext';

export default function Send() {
  const { chain } = useChain();

  return (
    <section>
      <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
        Send
      </h1>
      <p className="text-sm text-on-surface-variant">
        Send a stealth payment on {chain === 'horizen' ? 'Horizen' : 'Stellar'}.
      </p>
    </section>
  );
}
