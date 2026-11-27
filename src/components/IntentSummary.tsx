import { describeIntent, type TransactionIntent } from '@/lib/txIntent';

export interface IntentSummaryProps {
  intent: TransactionIntent;
  title?: string;
  status?: string;
  description?: string;
}

export function IntentSummary({
  intent,
  title = 'Confirm transaction',
  status = 'Fingerprint bound',
  description = 'These are the exact values the wallet will sign. Nothing is submitted unless the signed payload matches this fingerprint.',
}: IntentSummaryProps) {
  return (
    <div
      data-testid="intent-confirmation"
      className="border border-outline-variant bg-surface-container p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="font-heading text-[11px] uppercase tracking-widest text-on-surface">
          {title}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {status}
        </span>
      </div>
      <p className="mt-2 text-xs text-on-surface-variant">{description}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        {describeIntent(intent).map((field) => (
          <div key={field.label} className="flex items-start justify-between gap-4">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {field.label}
            </dt>
            <dd
              data-testid={field.label === 'Intent fingerprint' ? 'intent-fingerprint' : undefined}
              className="max-w-[65%] min-w-0 break-all text-right font-mono text-xs text-on-surface-variant"
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
