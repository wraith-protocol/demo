import { useEffect } from 'react';
import { pendingEntries } from '@/lib/offlineQueue';
import { useOfflineQueueStore } from '@/stores/offlineQueueStore';

/**
 * Reconnect trigger for the explicit offline queue (Wave 9, issue #184).
 *
 * - Runs reconciliation when the browser fires `online`.
 * - Runs it when the service worker asks via an `OFFLINE_QUEUE_FLUSH`
 *   message (Background Sync `wraith-offline-queue` tag).
 * - Runs once on mount when entries are already pending (covers reloads
 *   that land on a live connection — e.g. seed-then-reload flows).
 *
 * Reconciliation itself is a no-op while offline, so flapping connections
 * can't half-advance the queue.
 */
export function useOfflineReconcile() {
  useEffect(() => {
    const store = useOfflineQueueStore;

    const maybeReconcile = () => {
      const { entries } = store.getState();
      if (pendingEntries(entries).length === 0) return;
      void store.getState().reconcile();
    };

    const handleOnline = () => {
      maybeReconcile();
    };

    const handleMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === 'OFFLINE_QUEUE_FLUSH') {
        maybeReconcile();
      }
    };

    window.addEventListener('online', handleOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    // Mount pass: a reload with a live connection still has pending work.
    maybeReconcile();

    return () => {
      window.removeEventListener('online', handleOnline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, []);
}
