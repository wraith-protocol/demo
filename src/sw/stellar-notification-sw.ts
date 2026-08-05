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
 *   id:        string,            // unique notification id (e.g. tx hash / stealth address)
 *   title:     string,
 *   body:      string,
 *   amount?:   string,            // e.g. "12.5"
 *   asset?:    string,            // e.g. "XLM"
 *   sender?:   string,            // stealth / ephemeral address
 *   data?:     Record<string, unknown>
 * }
 */

/// <reference lib="webworker" />
export {};

declare const self: ServiceWorkerGlobalScope;

// ─── constants ────────────────────────────────────────────────────────────────

const NOTIFICATION_CHANNEL = 'wraith-notifications';
const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
const DB_NAME = 'wraith-stellar-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'viewing-keys';
const SYNC_TAG = 'stellar-payment-scan';
const SYNC_INTERVAL_MINUTES = 15;

// ─── types ────────────────────────────────────────────────────────────────────

interface PushPayload {
  id: string;
  title: string;
  body: string;
  amount?: string;
  asset?: string;
  sender?: string;
  data?: Record<string, unknown>;
}

interface StoredViewingKey {
  publicKey: string;
  encryptedViewingKey: string;
  encryptedSpendingPubKey: string;
  encryptedSpendingScalar: string;
  lastScannedLedger?: number;
  timestamp: number;
}

interface NotificationData {
  stealthAddress: string;
  amount?: string;
  timestamp: number;
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
  const events = data.result?.events || [];
  const latestLedger = await fetchLatestLedger();
  return { events, latestLedger };
}

// ─── push payload helpers ─────────────────────────────────────────────────────

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

/** Broadcast to every open tab so the React store gets persisted immediately. */
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
      const { events, latestLedger } = await fetchAnnouncementEvents(startLedger);

      if (events.length > 0) {
        // TODO: decrypt viewing key and run full SDK scan once SDK is
        // available in SW context. For now we surface a generic alert.
        console.log(`[wraith-sw] Found ${events.length} events for ${storedKey.publicKey}`);
      }

      await updateLastScannedLedger(db, storedKey.publicKey, latestLedger);
    }

    db.close();
  } catch (error) {
    console.error('[wraith-sw] Background sync error:', error);
  }
}

// ─── push event ───────────────────────────────────────────────────────────────

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePushPayload(event);

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

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, notificationOptions),
      broadcastToClients(payload),
    ]),
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

// ─── message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { type, publicKey, encryptedViewingKey, encryptedSpendingPubKey, encryptedSpendingScalar } =
    event.data ?? {};

  if (type === 'REGISTER_VIEWING_KEY') {
    event.waitUntil(
      (async () => {
        try {
          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const entry: StoredViewingKey = {
            publicKey,
            encryptedViewingKey,
            encryptedSpendingPubKey,
            encryptedSpendingScalar,
            timestamp: Date.now(),
          };
          await new Promise<void>((resolve, reject) => {
            const request = store.put(entry);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });
          db.close();
          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_REGISTERED' });
        } catch (error) {
          console.error('[wraith-sw] Failed to register viewing key:', error);
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

          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_UNREGISTERED' });
        } catch (error) {
          console.error('[wraith-sw] Failed to unregister viewing key:', error);
        }
      })(),
    );
  }

  if (type === 'TRIGGER_SCAN') {
    event.waitUntil(handleSync(event as unknown as ExtendableEvent));
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
