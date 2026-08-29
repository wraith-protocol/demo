/// <reference lib="webworker" />
/// <reference path="../vite-env.d.ts" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

// ─── Workbox precache ──────────────────────────────────────────────────────────
// vite-plugin-pwa injects the manifest list here at build time.
// In dev mode (when devOptions.enabled=true) this is an empty array.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Runtime caching ──────────────────────────────────────────────────────────
const RPC_HOSTNAMES = [
  'soroban-testnet.stellar.org',
  'horizen-testnet.rpc.caldera.xyz',
  'horizon-testnet.stellar.org',
];

// NetworkFirst for all RPC endpoints
registerRoute(
  ({ url }) => RPC_HOSTNAMES.some((h) => url.hostname.includes(h)),
  new NetworkFirst({
    cacheName: 'rpc-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// CacheFirst for Google Fonts CSS
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 31536000 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// CacheFirst for Google Fonts files
registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 31536000 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// ─── Stellar Notification Service Worker logic ────────────────────────────────
// (merged from src/sw/stellar-notification-sw.ts)

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
const DB_NAME = 'wraith-stellar-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'viewing-keys';
const SYNC_TAG = 'stellar-payment-scan';
const SYNC_INTERVAL_MINUTES = 15;

interface StoredViewingKey {
  publicKey: string;
  encryptedViewingKey: string;
  encryptedSpendingPubKey: string;
  encryptedSpendingScalar: string;
  lastScannedLedger?: number;
  timestamp: number;
  relayUrl?: string;
  metaAddressHash?: string;
  pushSubscription?: PushSubscriptionJSON;
}

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface NotificationData {
  stealthAddress: string;
  amount?: string;
  timestamp: number;
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'publicKey' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

async function updateLastScannedLedger(
  db: IDBDatabase,
  publicKey: string,
  ledger: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(publicKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const data = request.result as StoredViewingKey;
      if (data) {
        data.lastScannedLedger = ledger;
        data.timestamp = Date.now();
        const updateRequest = store.put(data);
        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => resolve();
      } else {
        resolve();
      }
    };
  });
}

// ── Stellar RPC helpers ────────────────────────────────────────────────────────

async function fetchLatestLedger(): Promise<number> {
  const response = await fetch(STELLAR_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const data = await response.json();
  return data.result?.sequence || 0;
}

async function fetchAnnouncementEvents(
  startLedger: number,
  contractId: string = ANNOUNCER_CONTRACT,
): Promise<{ events: unknown[]; latestLedger: number }> {
  const response = await fetch(STELLAR_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'getEvents',
      params: {
        startLedger,
        filters: [{ type: 'contract', contractIds: [contractId] }],
        pagination: { limit: 1000 },
      },
    }),
  });
  const data = await response.json();
  const events = data.result?.events || [];
  const latestLedger = await fetchLatestLedger();
  return { events, latestLedger };
}

// ── Background sync handler ────────────────────────────────────────────────────

async function handleSync(): Promise<void> {
  try {
    const db = await openDB();
    const allKeys = await new Promise<StoredViewingKey[]>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });

    for (const storedKey of allKeys) {
      const startLedger = storedKey.lastScannedLedger || 1;
      const { events, latestLedger } = await fetchAnnouncementEvents(startLedger);

      if (events.length > 0) {
        console.log(`Found ${events.length} events for ${storedKey.publicKey}`);
        // TODO: decrypt and scan with Wraith SDK when bundled in SW context
      }

      await updateLastScannedLedger(db, storedKey.publicKey, latestLedger);
    }

    db.close();
  } catch (error) {
    console.error('Background sync error:', error);
  }
}

// ── SW lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  console.log('[app-sw] Installing — skip waiting');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log('[app-sw] Activating');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      (async () => {
        if ('periodicSync' in self.registration) {
          try {
            await (
              self.registration as ServiceWorkerRegistration & {
                periodicSync: { register(tag: string, opts: object): Promise<void> };
              }
            ).periodicSync.register(SYNC_TAG, {
              minInterval: SYNC_INTERVAL_MINUTES * 60 * 1000,
            });
            console.log('[app-sw] Periodic sync registered');
          } catch (error) {
            console.error('[app-sw] Failed to register periodic sync:', error);
          }
        }
      })(),
    ]),
  );
});

// ── Background sync event ──────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(handleSync());
  }
});

// ── Notification click ─────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data as NotificationData;
  notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing Wraith tab and navigate to /notifications
      const existing = clientList.find((c) => c.url.includes(self.location.origin) && 'focus' in c);
      if (existing) {
        (existing as WindowClient).focus();
        (existing as WindowClient).navigate('/notifications');
        // Also post match info so the page can pre-highlight it
        if (data?.stealthAddress) {
          existing.postMessage({ type: 'NAVIGATE_TO_MATCH', stealthAddress: data.stealthAddress });
        }
        return;
      }
      const dest = data?.stealthAddress
        ? `/notifications?match=${data.stealthAddress}`
        : '/notifications';
      return self.clients.openWindow(dest);
    }),
  );
});

// ── Message handler ────────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, publicKey, encryptedViewingKey, encryptedSpendingPubKey, encryptedSpendingScalar } =
    event.data;

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'REGISTER_VIEWING_KEY') {
    event.waitUntil(
      (async () => {
        try {
          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const data: StoredViewingKey = {
            publicKey,
            encryptedViewingKey,
            encryptedSpendingPubKey,
            encryptedSpendingScalar,
            timestamp: Date.now(),
          };
          await new Promise<void>((resolve, reject) => {
            const request = store.put(data);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });
          db.close();
          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_REGISTERED' });
        } catch (error) {
          console.error('[app-sw] Failed to register viewing key:', error);
          (event.source as Client)?.postMessage({
            type: 'VIEWING_KEY_ERROR',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })(),
    );
  }

  if (type === 'UNREGISTER_VIEWING_KEY') {
    event.waitUntil(
      (async () => {
        try {
          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          await new Promise<void>((resolve, reject) => {
            const request = store.delete(publicKey);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });

          // Unregister periodic sync if no keys remain
          const allKeys = await new Promise<StoredViewingKey[]>((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readonly');
            const st = tx.objectStore(STORE_NAME);
            const req = st.getAll();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result || []);
          });
          db.close();

          if (allKeys.length === 0 && 'periodicSync' in self.registration) {
            await (
              self.registration as ServiceWorkerRegistration & {
                periodicSync: { unregister(tag: string): Promise<void> };
              }
            ).periodicSync.unregister(SYNC_TAG);
          }

          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_UNREGISTERED' });
        } catch (error) {
          console.error('[app-sw] Failed to unregister viewing key:', error);
        }
      })(),
    );
  }

  if (type === 'TRIGGER_SCAN') {
    event.waitUntil(handleSync());
  }

  // Push subscription management
  if (type === 'REGISTER_PUSH_SUBSCRIPTION') {
    event.waitUntil(
      (async () => {
        try {
          const { subscription, metaAddressHash, relayUrl } = event.data ?? {};
          if (!subscription || !metaAddressHash) {
            throw new Error('Missing subscription or metaAddressHash');
          }

          // Store subscription info in IndexedDB
          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          // Update existing entry or create new one
          const existing = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
            const request = store.get(subscription.keys?.p256dh || 'default');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });

          const entry: StoredViewingKey = existing || {
            publicKey: subscription.keys?.p256dh || 'default',
            encryptedViewingKey: '',
            encryptedSpendingPubKey: '',
            encryptedSpendingScalar: '',
            timestamp: Date.now(),
          };

          // Store relay URL and meta-address hash
          (entry as any).relayUrl = relayUrl;
          (entry as any).metaAddressHash = metaAddressHash;
          (entry as any).pushSubscription = subscription;

          await new Promise<void>((resolve, reject) => {
            const request = store.put(entry);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });

          db.close();
          (event.source as Client)?.postMessage({ type: 'PUSH_SUBSCRIPTION_REGISTERED' });
        } catch (error) {
          console.error('[app-sw] Failed to register push subscription:', error);
          (event.source as Client)?.postMessage({
            type: 'PUSH_SUBSCRIPTION_ERROR',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })(),
    );
  }

  if (type === 'UNREGISTER_PUSH_SUBSCRIPTION') {
    event.waitUntil(
      (async () => {
        try {
          const { subscription, metaAddressHash } = event.data ?? {};
          if (!subscription) {
            throw new Error('Missing subscription');
          }

          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          // Remove push subscription from entry
          const existing = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
            const request = store.get(subscription.keys?.p256dh || 'default');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });

          if (existing) {
            delete (existing as any).relayUrl;
            delete (existing as any).metaAddressHash;
            delete (existing as any).pushSubscription;

            await new Promise<void>((resolve, reject) => {
              const request = store.put(existing);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve();
            });
          }

          db.close();
          (event.source as Client)?.postMessage({ type: 'PUSH_SUBSCRIPTION_UNREGISTERED' });
        } catch (error) {
          console.error('[app-sw] Failed to unregister push subscription:', error);
          (event.source as Client)?.postMessage({
            type: 'PUSH_SUBSCRIPTION_ERROR',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })(),
    );
  }
});

// ── Push (future) ──────────────────────────────────────────────────────────────

interface PushPayload {
  id: string;
  title: string;
  body: string;
  amount?: string;
  asset?: string;
  sender?: string;
  data?: Record<string, unknown>;
}

interface NotificationData {
  stealthAddress: string;
  amount?: string;
  timestamp: number;
}

// Store for deduplication of notifications
const PROCED_NOTIFICATIONS = new Set<string>();

// Helper to check if notification was already processed
function isNotificationProcessed(id: string): boolean {
  if (PROCED_NOTIFICATIONS.has(id)) {
    return true;
  }
  PROCED_NOTIFICATIONS.add(id);
  // Limit cache size to prevent memory issues
  if (PROCED_NOTIFICATIONS.size > 1000) {
    const first = PROCED_NOTIFICATIONS.values().next().value;
    PROCED_NOTIFICATIONS.delete(first);
  }
  return false;
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

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePushPayload(event);

  // Deduplicate: skip if we've already processed this notification
  if (isNotificationProcessed(payload.id)) {
    console.log(`[app-sw] Skipping duplicate notification: ${payload.id}`);
    return;
  }

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
      stealthAddress: payload.sender,
      amount: payload.amount,
      asset: payload.asset,
      sender: payload.sender,
      timestamp: Date.now(),
      ...payload.data,
    } as NotificationData & Record<string, unknown>,
  };

  event.waitUntil(self.registration.showNotification(payload.title, notificationOptions));
});

export {};
