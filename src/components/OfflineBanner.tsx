import { useState, useEffect } from 'react';

/**
 * OfflineBanner
 *
 * Shows a non-dismissible banner at the top of the page when the browser
 * loses network connectivity. Disappears automatically when the connection
 * is restored. Uses the browser's `online`/`offline` events together with
 * `navigator.onLine` for the initial state.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
    }
    function handleOnline() {
      setIsOffline(false);
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

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
          You're offline. Cached data is shown — transactions require a connection.
        </p>
      </div>
    </div>
  );
}
