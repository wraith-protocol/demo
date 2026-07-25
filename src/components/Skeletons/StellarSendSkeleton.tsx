/**
 * StellarSendSkeleton
 *
 * Placeholder that mirrors the visible layout of StellarSend / StellarSendView
 * so the page never shifts when the real component mounts (CLS ≤ 0.05).
 *
 * Structure mirrors:
 *   section.flex-col.gap-8
 *     ├── header  (chain badge + h1)
 *     ├── wallet-connect button
 *     ├── form
 *     │     ├── recipient field (label + input)
 *     │     ├── asset selector row
 *     │     ├── amount field (label + input + balance)
 *     │     └── send button
 *     └── simulation panel placeholder
 */
import { SkeletonBlock } from './SkeletonBlock';

export function StellarSendSkeleton() {
  return (
    <section aria-label="Loading send page" className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        {/* chain badge  */}
        <SkeletonBlock className="h-3 w-40" />
        {/* h1 */}
        <SkeletonBlock className="h-8 w-24" />
        {/* subtitle */}
        <SkeletonBlock className="h-4 w-72" />
      </div>

      {/* ── Wallet-connect area ── */}
      <SkeletonBlock className="h-10 w-full" />

      {/* ── Form ── */}
      <div className="flex flex-col gap-6">
        {/* Recipient field */}
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Asset selector row */}
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-10 w-28" />
          <SkeletonBlock className="h-3 w-20" />
        </div>

        {/* Amount field */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3 w-16" />
            {/* balance */}
            <SkeletonBlock className="h-3 w-24" />
          </div>
          <SkeletonBlock className="h-10 w-full" />
        </div>

        {/* Send button */}
        <SkeletonBlock className="h-12 w-full" />
      </div>

      {/* ── Simulation panel ── */}
      <div className="flex flex-col gap-2 border border-outline-variant p-4">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="h-3 w-48" />
        <SkeletonBlock className="h-3 w-40" />
      </div>
    </section>
  );
}
