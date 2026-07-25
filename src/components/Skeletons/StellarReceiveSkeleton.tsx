/**
 * StellarReceiveSkeleton
 *
 * Mirrors the "keys derived + scanning" state of StellarReceive / StellarReceiveView
 * which is the most commonly loaded state (wallet already connected).
 *
 * Structure mirrors:
 *   section.flex-col.gap-8
 *     ├── header  (chain badge + h1 + subtitle)
 *     ├── meta-address card (border box with label + truncated address + copy)
 *     ├── registration card (border box)
 *     ├── scan button
 *     ├── search + filter row
 *     └── match list placeholder (3 rows)
 */
import { SkeletonBlock } from './SkeletonBlock';

export function StellarReceiveSkeleton() {
  return (
    <section aria-label="Loading receive page" className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-40" />
        <SkeletonBlock className="h-8 w-28" />
        <SkeletonBlock className="h-4 w-80" />
      </div>

      {/* ── Meta-address card ── */}
      <div className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-3 w-36" />
          {/* copy button placeholder */}
          <SkeletonBlock className="h-6 w-6" />
        </div>
        {/* address value – two lines to match actual wrap */}
        <SkeletonBlock className="h-4 w-full" />
        <SkeletonBlock className="h-4 w-3/4" />
      </div>

      {/* ── Registration card ── */}
      <div className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-5">
        <SkeletonBlock className="h-3 w-40" />
        <SkeletonBlock className="h-10 w-full" />
      </div>

      {/* ── Scan button ── */}
      <SkeletonBlock className="h-12 w-full" />

      {/* ── Search + filter row ── */}
      <div className="flex gap-3">
        <SkeletonBlock className="h-9 flex-1" />
        <SkeletonBlock className="h-9 w-24" />
      </div>

      {/* ── Match rows (3 placeholders) ── */}
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 border border-outline-variant p-4">
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonBlock className="h-4 w-16" />
            </div>
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </section>
  );
}
