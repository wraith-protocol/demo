import { useChain } from '@/context/ChainContext';
import type { Chain } from '@/context/ChainContext';

const chains: { id: Chain; label: string }[] = [
  { id: 'horizen', label: 'Horizen' },
  { id: 'stellar', label: 'Stellar' },
  { id: 'solana', label: 'Solana' },
  { id: 'ckb', label: 'CKB' },
];

export function ChainSwitcher() {
  const { chain, setChain } = useChain();

  return (
    <div className="relative">
      <select
        value={chain}
        onChange={(e) => setChain(e.target.value as Chain)}
        className="appearance-none border border-outline-variant bg-surface-container px-4 py-2 pr-8 font-heading text-xs uppercase tracking-widest text-primary focus:border-primary focus:outline-none"
      >
        {chains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
        <svg className="h-3 w-3 text-outline" viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        </svg>
      </div>
    </div>
  );
}
