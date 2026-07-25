/**
 * stellar-notification-sw.ts
 *
 * Stellar stealth-payment push notification service worker.
 *
 * Responsibilities:
 * 1. Receive push events and show browser notifications.
 * 2. Persist each notification into the app's zustand store by posting a
 *    message to all controlled clients so the React app can call
 *    `addNotification` on the next load (or immediately if a tab is open).
 *
 * Expected push payload (JSON):
 * {
 *   id:        string,            // unique notification id (e.g. tx hash / stealth address)
 *   title:     string,
 *   body:      string,
 *   amount?:   string,            // e.g. "12.5"
 *   asset?:    string,            // e.g. "XLM"
 *   sender?:   string,            // stealth / ephemeral address
 *   data?:     Record<string, unknown>
 * }
 *
 * If the push event carries no parseable JSON the worker falls back to a
 * generic "New stealth payment detected" notification so the user always gets
 * alerted.
 */

/// <reference lib="webworker" />
export {};

declare const self: ServiceWorkerGlobalScope;

const NOTIFICATION_CHANNEL = 'wraith-notifications';

// ─── helpers ─────────────────────────────────────────────────────────────────

interface PushPayload {
  id: string;
  title: string;
  body: string;
  amount?: string;
  asset?: string;
  sender?: string;
  data?: Record<string, unknown>;
}

function parsePushPayload(event: PushEvent): PushPayload {
  try {
    const json = event.data?.json() as Partial<PushPayload> | undefined;
    if (json && json.title) {
      return {
        id: json.id ?? `sw-${Date.now()}`,
        title: json.title,
        body: json.body ?? '',
        amount: json.amount,
        asset: json.asset,
        sender: json.sender,
        data: json.data,
      };
    }
  } catch {
    // ignore parse errors — fall through to default
  }

  return {
    id: `sw-${Date.now()}`,
    title: 'New stealth payment detected',
    body: 'Open Wraith to view payment details.',
  };
}

/** Broadcast to every controlled tab so the React store gets persisted. */
async function broadcastToClients(payload: PushPayload): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'WRAITH_NOTIFICATION',
      channel: NOTIFICATION_CHANNEL,
      payload: {
        ...payload,
        timestamp: Date.now(),
      },
    });
  }
}

// ─── push event ──────────────────────────────────────────────────────────────

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePushPayload(event);

  // Build the notification options
  const lines: string[] = [payload.body];
  if (payload.amount && payload.asset) {
    lines.push(`Amount: ${payload.amount} ${payload.asset}`);
  } else if (payload.amount) {
    lines.push(`Amount: ${payload.amount}`);
  }
  if (payload.sender) {
    const short =
      payload.sender.length > 24
        ? `${payload.sender.slice(0, 10)}…${payload.sender.slice(-10)}`
        : payload.sender;
    lines.push(`From: ${short}`);
  }

  const notificationOptions: NotificationOptions = {
    body: lines.join('\n'),
    icon: '/favicon-32x32.png',
    badge: '/favicon-16x16.png',
    tag: payload.id,
    data: {
      id: payload.id,
      amount: payload.amount,
      asset: payload.asset,
      sender: payload.sender,
      ...payload.data,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, notificationOptions),
      broadcastToClients(payload),
    ]),
  );
});

// ─── notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there is already a Wraith tab open, focus it and navigate to /notifications
      const existingClient = clientList.find(
        (c) => c.url.includes(self.location.origin) && 'focus' in c,
      );
      if (existingClient) {
        (existingClient as WindowClient).focus();
        (existingClient as WindowClient).navigate('/notifications');
        return;
      }
      // Otherwise open a new tab
      return self.clients.openWindow('/notifications');
    }),
  );
});

// ─── install / activate ───────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
