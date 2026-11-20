import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { actionableEntries, pendingEntries } from '@/lib/offlineQueue';
import { useOfflineQueueStore } from '@/stores/offlineQueueStore';

/**
 * OfflineBanner
 *
 * Shows a non-dismissible banner at the top of the page when the browser
 * loses network connectivity. Disappears automatically when the connection
 * is restored. Uses the browser's `online`/`offline` events together with
 * `navigator.onLine` for the initial state.
 *
 * Wave 9 (#184): the banner is queue-aware. While offline it reports how
 * many items are queued for reconciliation; right after reconnect it shows
 * the reconciling state and then how many items need review, linking to
 * the Send page where the OfflineQueuePanel lives.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const entries = useOfflineQueueStore((state) => state.entries);
  const phase = useOfflineQueueStore((state) => state.phase);

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
    }
    function handleOnline() {
      setIsOffline(false);
      setReviewDismissed(false);
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const queued = pendingEntries(entries).length;
  const actionable = actionableEntries(entries).length;

  if (isOffline) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Network status"
        className="border-b border-outline-variant bg-surface-container px-4 py-2.5 sm:px-6"
      >
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          {/* Offline icon */}
          <svg
            className="h-4 w-4 shrink-0 text-outline"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {/* Signal arc crossed out */}
            <path d="M2 2l12 12" strokeLinecap="square" />
            <path d="M6.2 4.8A5 5 0 0 1 13 8" strokeLinecap="square" />
            <path d="M9.4 7A2 2 0 0 1 10 8" strokeLinecap="square" />
            <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
          </svg>

          <p className="text-sm text-on-surface-variant">
            You&apos;re offline. Cached data is shown — transactions require a connection.
            {queued > 0 && (
              <>
                {' '}
                <span data-testid="offline-queue-count">
                  {queued} item{queued === 1 ? '' : 's'} queued
                </span>{' '}
                — will reconcile on reconnect.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'reconciling') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Network status"
        className="border-b border-outline-variant bg-surface-container px-4 py-2.5 sm:px-6"
      >
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <p className="text-sm text-on-surface-variant">Back online — reconciling queued work…</p>
        </div>
      </div>
    );
  }

  if (actionable > 0 && !reviewDismissed) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Network status"
        className="border-b border-outline-variant bg-surface-container px-4 py-2.5 sm:px-6"
      >
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <p className="text-sm text-on-surface-variant">
            Back online — {actionable} queued item{actionable === 1 ? '' : 's'} need
            {actionable === 1 ? 's' : ''} review.{' '}
            <Link to="/send" className="underline hover:text-on-surface">
              Review
            </Link>
          </p>
          <button
            type="button"
            onClick={() => setReviewDismissed(true)}
            aria-label="Dismiss reconnect notice"
            className="ml-auto shrink-0 px-2 py-1 text-sm text-outline hover:text-on-surface"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return null;
}
