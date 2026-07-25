/**
 * StellarActivitySkeleton
 *
 * Mirrors the connected state of StellarHistory.
 *
 * Structure mirrors:
 *   section.flex-col.gap-8
 *     ├── header row  (chain badge + h1  ||  clear button)
 *     ├── filter row  (Type select + Status select)
 *     └── activity list (5 row placeholders)
 *           each row: kind badge | address | amount | status chip
 */
import { SkeletonBlock } from './SkeletonBlock';

export function StellarActivitySkeleton() {
  return (
    <section aria-label="Loading activity history" className="flex flex-col gap-8">
      {/* ── Header row ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-3 w-40" />
          <SkeletonBlock className="h-8 w-40" />
        </div>
        {/* Clear history button */}
        <SkeletonBlock className="h-9 w-32" />
      </div>

      {/* ── Filter row ── */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-10" />
          <SkeletonBlock className="h-9 w-36" />
        </div>
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-14" />
          <SkeletonBlock className="h-9 w-36" />
        </div>
      </div>

      {/* ── Activity rows (5 placeholders) ── */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between border border-outline-variant p-4"
          >
            <div className="flex flex-col gap-2">
              {/* kind badge */}
              <SkeletonBlock className="h-4 w-28" />
              {/* address */}
              <SkeletonBlock className="h-3 w-48" />
              {/* timestamp */}
              <SkeletonBlock className="h-3 w-24" />
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* amount */}
              <SkeletonBlock className="h-4 w-16" />
              {/* status chip */}
              <SkeletonBlock className="h-5 w-14" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
