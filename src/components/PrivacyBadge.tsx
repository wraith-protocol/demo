import { useState } from 'react';
import type { PrivacyScore } from '@/lib/privacy-score';

const GRADE_STYLES: Record<PrivacyScore['grade'], { dot: string; text: string; label: string }> = {
  green: { dot: 'bg-tertiary', text: 'text-tertiary', label: 'Private' },
  yellow: { dot: 'bg-outline', text: 'text-outline', label: 'At Risk' },
  red: { dot: 'bg-error', text: 'text-error', label: 'Exposed' },
};

const FACTOR_LABELS = {
  reuse: 'Address reuse',
  balance: 'Balance accumulation',
  timePattern: 'Transfer timing',
};

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value);
  const color = pct >= 75 ? 'bg-tertiary' : pct >= 40 ? 'bg-outline' : 'bg-error';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 bg-outline-variant">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[10px] text-on-surface-variant">{pct}</span>
    </div>
  );
}

export function PrivacyBadge({ score }: { score: PrivacyScore }) {
  const [open, setOpen] = useState(false);
  const { dot, text, label } = GRADE_STYLES[score.grade];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
        title="Privacy score — click for details"
        aria-label={`Privacy score: ${score.score}/100 (${label}). Click for details.`}
      >
        <span className={`inline-block h-2 w-2 ${dot}`} />
        <span className={`font-mono text-[10px] uppercase tracking-widest ${text}`}>{label}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm border border-outline-variant bg-surface-container p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Privacy score breakdown"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 ${dot}`} />
                <span className="font-heading text-sm font-bold uppercase tracking-widest text-on-surface">
                  Privacy Score
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-mono text-xl font-bold ${text}`}>{score.score}</span>
                <button
                  onClick={() => setOpen(false)}
                  className="font-mono text-[10px] text-outline transition-colors hover:text-primary"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {(Object.keys(score.factors) as Array<keyof typeof score.factors>).map((key) => (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {FACTOR_LABELS[key]}
                    </span>
                  </div>
                  <ScoreBar value={score.factors[key]} />
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-outline-variant/30 pt-4">
              <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">
                Computed locally from your scan history. Higher scores mean less on-chain
                correlation risk. Sweep funds promptly and avoid reusing addresses to stay private.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
