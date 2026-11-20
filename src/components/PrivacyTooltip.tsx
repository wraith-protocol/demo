interface PrivacyTooltipProps {
  onDismiss: () => void;
}

export function PrivacyTooltip({ onDismiss }: PrivacyTooltipProps) {
  return (
    <div className="border border-outline-variant bg-surface-container p-4 animate-in fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-outline">
            Privacy Notice
          </span>
          <p className="font-body text-xs leading-relaxed text-on-surface-variant">
            Labels are stored only in this browser. Clear browser data = lose labels. Wraith never
            sees them.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 border border-outline-variant px-3 py-1 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
