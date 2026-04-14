import { useChain } from '@/context/ChainContext';
import { HorizenSend } from '@/components/HorizenSend';

export default function Send() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="text-sm text-on-surface-variant">Stellar send coming soon.</p>
      </section>
    );
  }

  return <HorizenSend />;
}
