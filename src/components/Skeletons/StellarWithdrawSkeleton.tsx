/**
 * StellarWithdrawSkeleton
 *
 * Mirrors the connected state of StellarVault (deposit / claim / status tabs).
 *
 * Structure mirrors:
 *   section.flex-col.gap-8
 *     ├── header  (chain badge + h1 + subtitle)
 *     ├── tab bar (3 tabs)
 *     └── active tab content  (deposit form — the default tab)
 *           ├── label + input  (unlock timestamp)
 *           ├── label + input  (amount)
 *           ├── label + input  (recipient)
 *           └── submit button
 */
import { SkeletonBlock } from './SkeletonBlock';

export function StellarWithdrawSkeleton() {
  return (
    <section aria-label="Loading vault page" className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-40" />
        <SkeletonBlock className="h-8 w-32" />
        <SkeletonBlock className="h-4 w-96 max-w-full" />
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-2 border-b border-outline-variant pb-px">
        {['w-28', 'w-16', 'w-20'].map((w, i) => (
          <SkeletonBlock key={i} className={`h-10 ${w}`} />
        ))}
      </div>

      {/* ── Deposit form (default tab) ── */}
      <div className="flex flex-col gap-6">
        {/* Unlock timestamp */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Recipient */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Submit */}
        <SkeletonBlock className="h-12 w-full" />
      </div>
    </section>
  );
}
