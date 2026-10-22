/**
 * Suspense fallback shown while a lazy-loaded route chunk is downloading.
 * Routes are code-split (see App.tsx) so the initial bundle only ships the
 * app shell; this fills the gap between navigation and the chunk arriving.
 */
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="flex min-h-[40vh] items-center justify-center py-16"
    >
      <p className="font-heading text-[11px] uppercase tracking-widest text-outline">Loading…</p>
    </div>
  );
}
