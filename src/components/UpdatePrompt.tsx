import { useAppUpdate } from '@/hooks/useAppUpdate';

/**
 * UpdatePrompt
 *
 * Shows a dismissible banner when a new service worker has finished installing
 * and is waiting to take over. The old worker keeps serving the current app
 * until the user chooses to reload, so a deploy never interrupts an in-flight
 * transaction or a half-derived stealth key.
 *
 * "Later" hides the prompt for this session; the next deploy re-announces
 * itself. Reloading is what actually swaps the worker (and therefore the
 * versioned caches).
 */
export function UpdatePrompt() {
  const { promptVisible, applying, error, applyUpdate, dismiss } = useAppUpdate();

  if (!promptVisible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Application update"
      className="border-b border-outline-variant bg-surface-container px-4 py-2.5 sm:px-6"
    >
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-3">
        <p className="flex-1 font-body text-sm text-on-surface-variant">
          A new version of Wraith is ready.
          {error && (
            <span role="alert" className="ml-1 text-error">
              Update failed: {error}
            </span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={applyUpdate}
            disabled={applying}
            className="h-8 border border-primary px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-surface disabled:opacity-50"
          >
            {applying ? 'Reloading...' : 'Reload'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={applying}
            className="h-8 px-2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant disabled:opacity-50"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
