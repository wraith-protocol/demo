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
        className="h-8 appearance-none border border-outline-variant bg-surface px-3 py-1.5 pr-7 font-mono text-[10px] uppercase tracking-widest text-primary focus:border-primary focus:outline-none sm:h-9 sm:px-4 sm:py-2 sm:pr-8 sm:text-xs"
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
