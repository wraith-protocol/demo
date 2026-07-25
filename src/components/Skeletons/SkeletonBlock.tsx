/**
 * SkeletonBlock – a single animated placeholder block.
 *
 * Uses a shimmer animation defined in index.css via the `animate-skeleton`
 * Tailwind utility.  All dimensions are passed as Tailwind classes so callers
 * control width/height while this component owns the animation, colour, and
 * aria attributes.
 */
import type { HTMLAttributes } from 'react';

interface SkeletonBlockProps extends HTMLAttributes<HTMLDivElement> {
  /** Extra Tailwind classes, e.g. "w-32 h-4" */
  className?: string;
}

export function SkeletonBlock({ className = '', ...rest }: SkeletonBlockProps) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={`animate-skeleton bg-outline-variant/40 ${className}`}
      {...rest}
    />
  );
}
