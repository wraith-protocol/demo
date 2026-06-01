import { useEffect, useState } from 'react';

export function OfflineShell({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-12 w-12 text-outline"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 3l18 18M8.111 8.111A7.5 7.5 0 0116.5 12m-1.415 4.085A4.5 4.5 0 019 12m-2.457-2.457A7.5 7.5 0 0112 4.5c1.93 0 3.7.731 5.03 1.93"
        />
      </svg>
      <h1 className="font-heading text-2xl font-semibold text-on-surface">You're offline</h1>
      <p className="max-w-sm text-on-surface-variant">
        Wraith needs a network connection for chain operations. Connect and refresh.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 border border-outline px-4 py-2 text-sm text-on-surface transition-colors hover:border-primary hover:text-primary"
      >
        Retry
      </button>
    </div>
  );
}
