import { useChain } from '@/context/ChainContext';
import type { Chain } from '@/context/ChainContext';

const chains: { id: Chain; label: string }[] = [
  { id: 'horizen', label: 'Horizen' },
  { id: 'stellar', label: 'Stellar' },
];

export function ChainSwitcher() {
  const { chain, setChain } = useChain();

  return (
    <div className="flex gap-0">
      {chains.map((c) => (
        <button
          key={c.id}
          onClick={() => setChain(c.id)}
          className={`px-4 py-2 font-heading text-xs uppercase tracking-widest transition-colors ${
            chain === c.id
              ? 'border-b-2 border-primary text-primary'
              : 'border-b-2 border-transparent text-on-surface-variant hover:text-primary'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
