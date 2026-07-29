import type { ReactNode } from 'react';

interface EmptyStateProps {
  illustration?: ReactNode;
  title: string;
  description?: string;
  primaryCTA?: {
    label: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({
  illustration,
  title,
  description,
  primaryCTA,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center gap-4 py-12 text-center ${className}`}>
      {illustration && <div className="mb-1 text-outline">{illustration}</div>}
      <p className="font-heading text-sm uppercase tracking-widest text-outline">{title}</p>
      {description && (
        <p className="max-w-sm font-body text-xs leading-relaxed text-on-surface-variant">
          {description}
        </p>
      )}
      {primaryCTA && (
        <button
          onClick={primaryCTA.onClick}
          className="mt-2 h-11 w-full max-w-[240px] bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110"
        >
          {primaryCTA.label}
        </button>
      )}
    </div>
  );
}
