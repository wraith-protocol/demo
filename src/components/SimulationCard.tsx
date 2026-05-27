import type { SimulationResult } from '@/lib/soroban';

interface SimulationCardProps {
  result: SimulationResult;
  isSimulating: boolean;
}

export function SimulationCard({ result, isSimulating }: SimulationCardProps) {
  if (isSimulating) {
    return (
      <div className="flex items-center gap-3 border border-outline-variant/50 bg-surface-container p-4">
        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary"></span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
          Simulating transaction...
        </span>
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-2 border border-error/30 bg-error/5 p-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-error"></span>
          <span className="font-heading text-[11px] font-semibold uppercase tracking-widest text-error">
            Simulation Failed
          </span>
        </div>
        <p className="font-mono text-xs leading-relaxed text-error">{result.error}</p>
        {result.isNetworkError && (
          <p className="font-mono text-[10px] text-on-surface-variant">
            Network issue — you can still try sending.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-outline-variant/50 bg-surface-container p-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
        <span className="font-heading text-[11px] font-semibold uppercase tracking-widest text-on-surface">
          Predicted Result
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
          (simulation only)
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Predicted Fee
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            {formatStroops(result.predictedFeeStroops)}
          </span>
        </div>

        {result.returnValue && (
          <div className="flex items-center justify-between gap-4">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-outline">
              Return Value
            </span>
            <span className="truncate font-mono text-[10px] text-on-surface-variant">
              {result.returnValue}
            </span>
          </div>
        )}

        {result.eventCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Contract Events
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {result.eventCount} announcement{result.eventCount !== 1 ? 's' : ''} will be emitted
            </span>
          </div>
        )}
      </div>

      <p className="font-mono text-[9px] leading-relaxed text-outline">
        This is a simulation. Actual results may differ when ledger state changes.
      </p>
    </div>
  );
}

function formatStroops(stroops: string): string {
  const val = parseInt(stroops, 10);
  if (isNaN(val)) return `${stroops} stroops`;
  const xlm = val / 10_000_000;
  return `${xlm.toFixed(7)} XLM (${stroops} stroops)`;
}
