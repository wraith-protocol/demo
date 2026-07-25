/**
 * StellarSettingsSkeleton
 *
 * Mirrors the Schedule page layout (the closest "Settings"-like page in this
 * app — recurring-payment configuration).
 *
 * Structure mirrors:
 *   div.flex-col.gap-8
 *     ├── header  (h1 + description)
 *     ├── create form
 *     │     ├── recipient input
 *     │     ├── amount + asset row
 *     │     ├── interval select
 *     │     ├── end-date input
 *     │     └── submit button
 *     └── schedule list (3 row placeholders)
 */
import { SkeletonBlock } from './SkeletonBlock';

export function StellarSettingsSkeleton() {
  return (
    <div aria-label="Loading schedule page" className="flex flex-col gap-8">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3">
        <SkeletonBlock className="h-8 w-32" />
        <SkeletonBlock className="h-4 w-full max-w-lg" />
        <SkeletonBlock className="h-4 w-3/4 max-w-md" />
      </header>

      {/* ── Create form ── */}
      <div className="flex flex-col gap-5 border border-outline-variant p-6">
        <SkeletonBlock className="h-4 w-40" />

        {/* Recipient */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Amount + asset row */}
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <SkeletonBlock className="h-3 w-16" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <SkeletonBlock className="h-3 w-12" />
            <SkeletonBlock className="h-10 w-24" />
          </div>
        </div>

        {/* Interval */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* End date */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Submit */}
        <SkeletonBlock className="h-12 w-full" />
      </div>

      {/* ── Schedule list (3 placeholders) ── */}
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between border border-outline-variant p-4"
          >
            <div className="flex flex-col gap-2">
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-40" />
            </div>
            <div className="flex gap-2">
              <SkeletonBlock className="h-8 w-16" />
              <SkeletonBlock className="h-8 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
