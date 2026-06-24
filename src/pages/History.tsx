import { useActivity } from '@/context/ActivityContext';
import { PrivacyBadge } from '@/components/PrivacyBadge';
import { computePrivacyScore } from '@/lib/privacy-score';

export default function History() {
  const { addresses } = useActivity();

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Local only
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          History
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Stealth addresses detected during this session. Privacy scores are computed locally.
        </p>
      </div>

      {addresses.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-heading text-sm uppercase tracking-widest text-outline">
            No addresses yet
          </p>
          <p className="mt-2 font-body text-xs text-on-surface-variant">
            Scan for payments on the Receive page to populate history.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-px border border-outline-variant">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 bg-surface-bright px-4 py-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
              Address
            </span>
            <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
              Balance
            </span>
            <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
              Privacy
            </span>
          </div>
          {addresses.map((entry) => {
            const score = computePrivacyScore({
              reuseCount: 1,
              balance: entry.balance,
              transferTimestamps: [],
            });
            return (
              <div
                key={entry.address}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-surface-container px-4 py-3"
              >
                <div className="min-w-0">
                  <span className="block truncate font-mono text-xs text-primary">
                    {entry.address}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-outline">
                    {entry.chain}
                  </span>
                </div>
                <span className="font-mono text-xs text-on-surface-variant whitespace-nowrap">
                  {parseFloat(entry.balance) > 0 ? entry.balance : '—'}
                </span>
                <PrivacyBadge score={score} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
