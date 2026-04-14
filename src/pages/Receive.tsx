import { useChain } from '@/context/ChainContext';
import { HorizenReceive } from '@/components/HorizenReceive';

export default function Receive() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Receive
        </h1>
        <p className="text-sm text-on-surface-variant">Stellar receive coming soon.</p>
      </section>
    );
  }

  return <HorizenReceive />;
}
