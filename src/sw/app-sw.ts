/// <reference lib="webworker" />
/// <reference path="../vite-env.d.ts" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { setCacheNameDetails } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { CACHE_PREFIX, CACHE_VERSION_SUFFIX, cacheName, purgeObsoleteCaches } from '../lib/swCache';
import {
  retentionErrorFromRpcMessage,
  retentionGapFromError,
  type RetentionGap,
} from '../lib/stellar/scannerCursor';
import {
  deliverPushNotification,
  type NotificationPresentation,
  type ValidatedPushPayload,
} from './notificationPayload';
import {
  claimNotificationId,
  createNotificationStore,
  pruneNotificationIds,
  releaseNotificationId,
} from './notificationStore';

declare const self: ServiceWorkerGlobalScope;

// ─── Explicit cache versioning ─────────────────────────────────────────────────
// Every cache this worker owns is named `wraith-<kind>-v<CACHE_VERSION>`. The
// version lives in the name, so a cache-schema change writes to a fresh cache
// and deletes the old one during activation instead of mutating entries in
// place. Bump CACHE_VERSION in src/lib/swCache.ts to migrate.
setCacheNameDetails({
  prefix: CACHE_PREFIX,
  suffix: CACHE_VERSION_SUFFIX,
  precache: 'precache',
  runtime: 'runtime',
});

// ─── Workbox precache ──────────────────────────────────────────────────────────
// vite-plugin-pwa injects the manifest list here at build time.
// In dev mode (when devOptions.enabled=true) this is an empty array.
precacheAndRoute(self.__WB_MANIFEST);
// Removes precaches carrying build-time revisions of earlier Workbox versions.
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
    cacheName: cacheName('rpc'),
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
    cacheName: cacheName('fonts-styles'),
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
    cacheName: cacheName('fonts-files'),
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
const DB_VERSION = 2;
const STORE_NAME = 'viewing-keys';
const SYNC_TAG = 'stellar-payment-scan';
const SYNC_INTERVAL_MINUTES = 15;

// Wave 9 (#184): tag the page registers when it enqueues offline work.
// The SW can't read the page's localStorage queue, so it just nudges every
// client to run reconciliation itself.
const QUEUE_SYNC_TAG = 'wraith-offline-queue';

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
  id: string;
  stealthAddress?: string;
  amount?: string;
  asset?: string;
  sender?: string;
  timestamp: number;
  url: string;
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
      createNotificationStore(db);
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
  if (data.error?.message) {
    const retentionError = retentionErrorFromRpcMessage(startLedger, String(data.error.message));
    throw retentionError ?? new Error(String(data.error.message));
  }
  const events = data.result?.events || [];
  const latestLedger = await fetchLatestLedger();
  return { events, latestLedger };
}

async function notifyRetentionGap(publicKey: string, gap: RetentionGap): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'STELLAR_SCAN_RETENTION_GAP', publicKey, ...gap });
  }
}

async function scanStoredKey(
  db: IDBDatabase,
  storedKey: StoredViewingKey,
  startLedger: number,
): Promise<void> {
  const { events, latestLedger } = await fetchAnnouncementEvents(startLedger);
  if (events.length > 0) {
    console.log(`Found ${events.length} events for ${storedKey.publicKey}`);
    // TODO: decrypt and scan with Wraith SDK when bundled in SW context
  }
  await updateLastScannedLedger(db, storedKey.publicKey, latestLedger + 1);
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
      try {
        await scanStoredKey(db, storedKey, startLedger);
      } catch (error) {
        const gap = retentionGapFromError(error);
        if (!gap) throw error;
        if (storedKey.lastScannedLedger === undefined) {
          await scanStoredKey(db, storedKey, gap.oldestAvailableLedger);
        } else {
          await notifyRetentionGap(storedKey.publicKey, gap);
        }
      }
    }

    db.close();
  } catch (error) {
    console.error('Background sync error:', error);
  }
}

// ── SW lifecycle ───────────────────────────────────────────────────────────────

// No `skipWaiting()` in `install` on purpose. A newly installed worker stays in
// the `waiting` state until the page posts SKIP_WAITING (the "Reload" action in
// the update prompt), so a deploy can never swap the app underneath an in-flight
// transaction. A first install activates without waiting for anything.

async function registerPeriodicSync(): Promise<void> {
  if (!('periodicSync' in self.registration)) return;

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

self.addEventListener('activate', (event) => {
  console.log('[app-sw] Activating');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Drop every cache this app owns that is not part of the running version:
      // superseded versions, newer versions left behind by a roll-back, and
      // caches written by installs that predate explicit versioning.
      purgeObsoleteCaches(self.caches).then((deleted) => {
        if (deleted.length > 0) console.log('[app-sw] Purged obsolete caches:', deleted);
      }),
      registerPeriodicSync(),
    ]),
  );
});

// ── Background sync event ──────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(handleSync());
    return;
  }
  if (event.tag === QUEUE_SYNC_TAG) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'OFFLINE_QUEUE_FLUSH' });
        }
      }),
    );
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
        (existing as WindowClient).navigate(data?.url ?? '/notifications');
        // Also post match info so the page can pre-highlight it
        if (data?.stealthAddress) {
          existing.postMessage({ type: 'NAVIGATE_TO_MATCH', stealthAddress: data.stealthAddress });
        }
        return;
      }
      return self.clients.openWindow(data?.url ?? '/notifications');
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

  if (type === 'RECOVER_SCAN_CURSOR') {
    event.waitUntil(
      (async () => {
        const db = await openDB();
        try {
          const recoveryLedger = Number(event.data.oldestAvailableLedger);
          if (
            typeof publicKey !== 'string' ||
            !Number.isSafeInteger(recoveryLedger) ||
            recoveryLedger <= 0
          ) {
            return;
          }
          const storedKey = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
            const request = db
              .transaction(STORE_NAME, 'readonly')
              .objectStore(STORE_NAME)
              .get(publicKey);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          if (!storedKey) return;
          await scanStoredKey(db, storedKey, recoveryLedger);
          const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          clients.forEach((client) =>
            client.postMessage({ type: 'STELLAR_SCAN_RECOVERY_COMPLETE', publicKey }),
          );
        } finally {
          db.close();
        }
      })(),
    );
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

async function broadcastToClients(payload: ValidatedPushPayload, timestamp: number): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'WRAITH_NOTIFICATION',
      channel: 'wraith-notifications',
      payload: { ...payload, timestamp },
    });
  }
}

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      const db = await openDB();
      try {
        const result = await deliverPushNotification(
          event.data?.text() ?? '',
          self.location.origin,
          {
            claim: (id) => claimNotificationId(db, id),
            release: (id) => releaseNotificationId(db, id),
            show: (presentation: NotificationPresentation) =>
              self.registration.showNotification(presentation.title, {
                body: presentation.body,
                icon: '/favicon-32x32.png',
                badge: '/favicon-16x16.png',
                tag: presentation.tag,
                data: presentation.data,
              }),
            broadcast: broadcastToClients,
          },
        );
        if (result === 'rejected') console.warn('[app-sw] Rejected invalid push payload');
        if (result === 'duplicate') console.log('[app-sw] Skipped duplicate notification');
        if (result === 'delivered') await pruneNotificationIds(db);
      } finally {
        db.close();
      }
    })(),
  );
});

export {};
