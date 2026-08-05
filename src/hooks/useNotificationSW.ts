import { useEffect } from 'react';
import { useNotificationsStore } from '@/stores/notificationsStore';

interface SWMessage {
  type: string;
  channel: string;
  payload: {
    id: string;
    title: string;
    body: string;
    timestamp: number;
    amount?: string;
    asset?: string;
    sender?: string;
    data?: Record<string, unknown>;
  };
}

/**
 * Registers the Stellar notification service worker and listens for
 * WRAITH_NOTIFICATION messages from it, persisting them into the
 * notifications store.
 *
 * Should be mounted once at the app root level.
 */
export function useNotificationSW() {
  const addNotification = useNotificationsStore((state) => state.addNotification);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Register the SW (Vite bundles SW files referenced via URL constructor)
    navigator.serviceWorker
      .register(new URL('../sw/stellar-notification-sw.ts', import.meta.url), { type: 'module' })
      .catch((err) => {
        // Non-fatal — notifications simply won't fire in this environment
        console.warn('[wraith] SW registration failed:', err);
      });

    // Listen for WRAITH_NOTIFICATION messages posted by the SW
    const handler = (event: MessageEvent<SWMessage>) => {
      if (
        event.data?.type !== 'WRAITH_NOTIFICATION' ||
        event.data?.channel !== 'wraith-notifications'
      ) {
        return;
      }
      const { id, title, body, timestamp, amount, asset, sender, data } = event.data.payload;
      addNotification({ id, title, body, timestamp, amount, asset, sender, data });
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handler);
    };
  }, [addNotification]);
}
