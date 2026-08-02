import { useNavigate } from 'react-router-dom';
import { useChain } from '@/context/ChainContext';
import { StellarHistory } from '@/components/StellarHistory';
import { EmptyState } from '@/components/EmptyState';

export default function History() {
  const navigate = useNavigate();
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarHistory />;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          History
        </h1>
      </section>
      <EmptyState
        illustration={
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="6" width="36" height="36" rx="0" />
            <line x1="14" y1="18" x2="34" y2="18" />
            <line x1="14" y1="24" x2="30" y2="24" />
            <line x1="14" y1="30" x2="26" y2="30" />
            <circle cx="36" cy="34" r="6" fill="currentColor" opacity="0.2" />
            <path d="M34 34l2 2 4-4" />
          </svg>
        }
        title="History coming soon"
        description={`Transaction history for ${chain.charAt(0).toUpperCase() + chain.slice(1)} is not yet available. Switch to Stellar to view activity.`}
        primaryCTA={{ label: 'Send your first payment', onClick: () => navigate('/send') }}
      />
    </div>
  );
}
