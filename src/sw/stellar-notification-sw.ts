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
 * 3. Periodic background sync to scan for new stealth payments.
 * 4. IndexedDB storage for encrypted viewing keys.
 * 5. Handle REGISTER_VIEWING_KEY / UNREGISTER_VIEWING_KEY messages from the
 *    client so background scanning knows which keys to watch.
 *
 * Push payload (JSON):
 * {
 *   version:   1,
 *   id?:       string,            // otherwise derived from the validated payload
 *   title:     string,
 *   body:      string,
 *   amount?:   string,            // e.g. "12.5"
 *   asset?:    string,            // e.g. "XLM"
 *   sender?:   string,            // stealth / ephemeral address
 *   url?:      string             // same-origin path only
 * }
 */

/// <reference lib="webworker" />
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
import {
  validateMainThreadMessage,
  validateWorkerMessage,
  type MainThreadMessage,
  type WorkerMessage,
} from '../lib/workerProtocol';
export {};

declare const self: ServiceWorkerGlobalScope;

// ─── constants ────────────────────────────────────────────────────────────────

const NOTIFICATION_CHANNEL = 'wraith-notifications';
const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
const DB_NAME = 'wraith-stellar-notifications';
const DB_VERSION = 2;
const STORE_NAME = 'viewing-keys';
const SYNC_TAG = 'stellar-payment-scan';
const SYNC_INTERVAL_MINUTES = 15;

// ─── types ────────────────────────────────────────────────────────────────────

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

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

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

// ─── Stellar RPC helpers ──────────────────────────────────────────────────────

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
  const response: WorkerMessage = {
    type: 'STELLAR_SCAN_RETENTION_GAP',
    publicKey,
    oldestAvailableLedger: gap.oldestAvailableLedger,
    lastScannedLedger: gap.lastScannedLedger,
  };
  for (const client of clients) {
    client.postMessage(response);
  }
}

async function scanStoredKey(
  db: IDBDatabase,
  storedKey: StoredViewingKey,
  startLedger: number,
): Promise<void> {
  const { events, latestLedger } = await fetchAnnouncementEvents(startLedger);
  if (events.length > 0) {
    console.log(`[wraith-sw] Found ${events.length} events for ${storedKey.publicKey}`);
    // TODO: decrypt viewing key and scan with the SDK when bundled in the worker.
  }
  await updateLastScannedLedger(db, storedKey.publicKey, latestLedger + 1);
}

// ─── push payload helpers ─────────────────────────────────────────────────────

/** Broadcast to every open tab so the React store gets persisted immediately. */
async function broadcastToClients(payload: ValidatedPushPayload, timestamp: number): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'WRAITH_NOTIFICATION',
      channel: NOTIFICATION_CHANNEL,
      payload: {
        ...payload,
        timestamp,
      },
    });
  }
}

// ─── background sync ──────────────────────────────────────────────────────────

async function handleSync(_event: ExtendableEvent): Promise<void> {
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
    console.error('[wraith-sw] Background sync error:', error);
  }
}

// ─── push event ───────────────────────────────────────────────────────────────

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
        if (result === 'rejected') console.warn('[wraith-sw] Rejected invalid push payload');
        if (result === 'duplicate') console.log('[wraith-sw] Skipped duplicate notification');
        if (result === 'delivered') await pruneNotificationIds(db);
      } finally {
        db.close();
      }
    })(),
  );
});

// ─── background sync event ────────────────────────────────────────────────────

self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(handleSync(event));
  }
});

// ─── notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const data = event.notification.data as NotificationData | undefined;
  event.notification.close();

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

// ─── message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const validation = validateMainThreadMessage(event.data);
  if (!validation.valid) {
    console.warn('[wraith-sw] Ignoring invalid message from main thread:', validation.reason);
    return;
  }

  const msg = validation.data;

  switch (msg.type) {
    case 'RECOVER_SCAN_CURSOR':
      event.waitUntil(
        (async () => {
          const db = await openDB();
          try {
            const storedKey = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
              const request = db
                .transaction(STORE_NAME, 'readonly')
                .objectStore(STORE_NAME)
                .get(msg.publicKey);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            });
            if (!storedKey) return;
            await scanStoredKey(db, storedKey, msg.oldestAvailableLedger);
            const clients = await self.clients.matchAll({
              type: 'window',
              includeUncontrolled: true,
            });
            const response: WorkerMessage = {
              type: 'STELLAR_SCAN_RECOVERY_COMPLETE',
              requestId: msg.requestId,
              publicKey: msg.publicKey,
            };
            clients.forEach((client) => client.postMessage(response));
          } finally {
            db.close();
          }
        })(),
      );
      return;

    case 'REGISTER_VIEWING_KEY':
      event.waitUntil(
        (async () => {
          try {
            const db = await openDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const entry: StoredViewingKey = {
              publicKey: msg.publicKey,
              encryptedViewingKey: msg.encryptedViewingKey,
              encryptedSpendingPubKey: msg.encryptedSpendingPubKey,
              encryptedSpendingScalar: msg.encryptedSpendingScalar,
              timestamp: Date.now(),
            };
            await new Promise<void>((resolve, reject) => {
              const request = store.put(entry);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve();
            });
            db.close();
            const response: WorkerMessage = { type: 'VIEWING_KEY_REGISTERED', requestId: msg.requestId };
            (event.source as Client)?.postMessage(response);
          } catch (error) {
            console.error('[wraith-sw] Failed to register viewing key:', error);
            const response: WorkerMessage = {
              type: 'VIEWING_KEY_ERROR',
              requestId: msg.requestId,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            (event.source as Client)?.postMessage(response);
          }
        })(),
      );
      return;

    case 'UNREGISTER_VIEWING_KEY':
      event.waitUntil(
        (async () => {
          try {
            const db = await openDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            await new Promise<void>((resolve, reject) => {
              const request = store.delete(msg.publicKey);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve();
            });
            db.close();

            // Unregister periodic sync if no keys remain
            const db2 = await openDB();
            const remaining = await new Promise<StoredViewingKey[]>((resolve, reject) => {
              const tx = db2.transaction([STORE_NAME], 'readonly');
              const st = tx.objectStore(STORE_NAME);
              const req = st.getAll();
              req.onerror = () => reject(req.error);
              req.onsuccess = () => resolve(req.result || []);
            });
            db2.close();

            if (remaining.length === 0 && 'periodicSync' in self.registration) {
              await (
                self.registration as unknown as {
                  periodicSync: { unregister: (tag: string) => Promise<void> };
                }
              ).periodicSync.unregister(SYNC_TAG);
            }

            const response: WorkerMessage = { type: 'VIEWING_KEY_UNREGISTERED', requestId: msg.requestId };
            (event.source as Client)?.postMessage(response);
          } catch (error) {
            console.error('[wraith-sw] Failed to unregister viewing key:', error);
          }
        })(),
      );
      return;

    case 'TRIGGER_SCAN':
      event.waitUntil(handleSync(event as unknown as ExtendableEvent));
      return;

    case 'REGISTER_PUSH_SUBSCRIPTION':
      event.waitUntil(
        (async () => {
          try {
            const db = await openDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            // Update existing entry or create new one
            const existing = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
              const request = store.get(msg.subscription.keys.p256dh || 'default');
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            });

            const entry: StoredViewingKey = existing || {
              publicKey: msg.subscription.keys.p256dh || 'default',
              encryptedViewingKey: '',
              encryptedSpendingPubKey: '',
              encryptedSpendingScalar: '',
              timestamp: Date.now(),
            };

            // Store relay URL and meta-address hash
            (entry as any).relayUrl = msg.relayUrl;
            (entry as any).metaAddressHash = msg.metaAddressHash;
            (entry as any).pushSubscription = msg.subscription;

            await new Promise<void>((resolve, reject) => {
              const request = store.put(entry);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve();
            });

            db.close();
            const response: WorkerMessage = { type: 'PUSH_SUBSCRIPTION_REGISTERED', requestId: msg.requestId };
            (event.source as Client)?.postMessage(response);
          } catch (error) {
            console.error('[wraith-sw] Failed to register push subscription:', error);
            const response: WorkerMessage = {
              type: 'PUSH_SUBSCRIPTION_ERROR',
              requestId: msg.requestId,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            (event.source as Client)?.postMessage(response);
          }
        })(),
      );
      return;

    case 'UNREGISTER_PUSH_SUBSCRIPTION':
      event.waitUntil(
        (async () => {
          try {
            const db = await openDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            // Remove push subscription from entry
            const existing = await new Promise<StoredViewingKey | undefined>((resolve, reject) => {
              const request = store.get(msg.subscription.keys.p256dh || 'default');
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
            const response: WorkerMessage = { type: 'PUSH_SUBSCRIPTION_UNREGISTERED', requestId: msg.requestId };
            (event.source as Client)?.postMessage(response);
          } catch (error) {
            console.error('[wraith-sw] Failed to unregister push subscription:', error);
            const response: WorkerMessage = {
              type: 'PUSH_SUBSCRIPTION_ERROR',
              requestId: msg.requestId,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            (event.source as Client)?.postMessage(response);
          }
        })(),
      );
      return;
  }
});

// ─── install / activate ───────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      (async () => {
        if ('periodicSync' in self.registration) {
          try {
            await (
              self.registration as unknown as {
                periodicSync: {
                  register: (tag: string, opts: { minInterval: number }) => Promise<void>;
                };
              }
            ).periodicSync.register(SYNC_TAG, {
              minInterval: SYNC_INTERVAL_MINUTES * 60 * 1000,
            });
          } catch {
            // periodicSync not supported in this environment — silently skip
          }
        }
      })(),
    ]),
  );
});
