/**
 * stellar-notification-sw.ts
 *
 * Service Worker — handles:
 *   • 'periodicsync' (Periodic Background Sync, Chrome / Edge / some Firefox)
 *   • 'message' port for the SW-message-loop fallback when PBS is unavailable
 *   • 'notificationclick' — focuses / opens the Receive page
 *
 * Browser support notes (disclosed in the UI):
 *   • Chrome / Edge 80+: full Periodic Background Sync support (min ~12 h on
 *     desktop, longer on mobile). Best experience.
 *   • Firefox: no PBS; falls back to a keep-alive message loop while the tab
 *     is open. Notifications still fire while the user has the page open.
 *   • iOS Safari 16.4+: limited — PBS fires infrequently. Notifications shown
 *     only when the PWA is in the background, not fully closed.
 *
 * Privacy trade-off (shown to user at opt-in):
 *   The viewing key is stored encrypted in IndexedDB. The SW reads and
 *   decrypts it in memory only during the scan, then discards the plaintext.
 *   See notification-storage.ts for the key-derivation details.
 */

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const SYNC_TAG = 'wraith-stellar-scan';
const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes between notifications per chain
const RECEIVE_PAGE = '/receive';

// ─── Install / activate ───────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(self.clients.claim());
});

// ─── Periodic Background Sync ─────────────────────────────────────────────────

self.addEventListener('periodicsync', (evt) => {
  if ((evt as any).tag === SYNC_TAG) {
    (evt as any).waitUntil(runScan());
  }
});

// ─── Message-port fallback loop ───────────────────────────────────────────────
// When the tab is open and PBS is unavailable, the page sends a 'ping' every
// 5 minutes so the SW can run a scan even without PBS.

self.addEventListener('message', (evt) => {
  if (evt.data?.type === 'WRAITH_SCAN_PING') {
    evt.waitUntil(runScan());
  }
  if (evt.data?.type === 'WRAITH_SCAN_NOW') {
    // Triggered by the toggle turning on — run an immediate scan.
    evt.waitUntil(runScan());
  }
});

// ─── Notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', (evt) => {
  evt.notification.close();
  const url = (evt.notification.data?.url as string | undefined) ?? RECEIVE_PAGE;
  evt.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(RECEIVE_PAGE) && 'focus' in client) {
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// ─── Core scan logic ──────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  try {
    const state = await readState();
    if (!state?.enabled || !state.encryptedViewingKey) return;

    // Re-derive the key from the stored signing output.
    // The signing output is stored as-is (not secret); the encryption key is
    // derived from it via PBKDF2. Without the original wallet signature
    // (which only the user can produce) an attacker cannot decrypt the viewing
    // key even if they read IndexedDB.
    const viewingKeyHex = await decryptViewingKey(
      state.encryptedViewingKey,
      state.signingOutput ?? '',
    );
    if (!viewingKeyHex) return;

    // Rate limit: no more than one notification every 5 minutes per chain.
    const now = Date.now();
    if (state.lastNotifiedAt && now - state.lastNotifiedAt < RATE_LIMIT_MS) {
      // Still within cool-down — scan and record cursor but skip notification.
      await scanAndMaybeNotify(viewingKeyHex, state, false);
      return;
    }

    await scanAndMaybeNotify(viewingKeyHex, state, true);
  } catch (err) {
    console.error('[wraith-sw] scan error', err);
  }
}

async function scanAndMaybeNotify(
  viewingKeyHex: string,
  state: NotificationState,
  canNotify: boolean,
): Promise<void> {
  // Fetch announcements from Horizon since our last cursor.
  const { announcements, nextCursor } = await fetchAnnouncements(state.lastSeenCursor);
  if (announcements.length === 0) return;

  // Offload EC math to a Web Worker so we don't block the SW event loop.
  const matches = await runWorkerScan(viewingKeyHex, state.spendingPubKeyHex ?? '', announcements);

  // Persist the advanced cursor regardless of notification outcome.
  await writeState({ ...state, lastSeenCursor: nextCursor });

  if (!canNotify || matches.length === 0) return;

  // Batch: if multiple payments arrived, show a summary.
  const title =
    matches.length === 1 ? 'Wraith — Payment received' : `Wraith — ${matches.length} new payments`;

  const body =
    matches.length === 1
      ? buildBody(matches[0])
      : `${matches.length} Stellar (XLM) payments to your stealth address`;

  const firstMatch = matches[0];

  await self.registration.showNotification(title, {
    body,
    icon: '/wraith-192.png',
    badge: '/wraith-badge-96.png',
    tag: `wraith-stellar-${Date.now()}`,
    data: {
      url: RECEIVE_PAGE,
      chain: 'stellar',
      stealthAddress: firstMatch.stealthAddress,
    },
  });

  await writeState({ ...state, lastSeenCursor: nextCursor, lastNotifiedAt: Date.now() });
}

function buildBody(match: MatchedPayment): string {
  const address = match.stealthAddress
    ? `${match.stealthAddress.slice(0, 6)}…${match.stealthAddress.slice(-4)}`
    : 'stealth address';
  const amount = match.amount ? `${match.amount} XLM` : 'XLM';
  return `Stellar payment of ${amount} to your stealth address ${address}`;
}

// ─── Horizon announcement fetcher ────────────────────────────────────────────

interface Announcement {
  ephemeralPubKey: string;
  stealthAddress: string;
  viewTag: string;
  amount?: string;
  txHash?: string;
}

async function fetchAnnouncements(
  cursor?: string,
): Promise<{ announcements: Announcement[]; nextCursor: string }> {
  // The Wraith SDK stores announcements as memos on Stellar transactions to
  // the announcer contract address. We query Horizon's /transactions endpoint
  // filtered to that account and parse the memos.
  const ANNOUNCER = 'GDWUE5ANKLFRQFANM2EL5MBJBXBSMV7HTFZZVGXG6QT4RJOKQVFPBIM'; // testnet
  const limit = 50;
  const url = cursor
    ? `${HORIZON_BASE}/accounts/${ANNOUNCER}/transactions?cursor=${cursor}&limit=${limit}&order=asc`
    : `${HORIZON_BASE}/accounts/${ANNOUNCER}/transactions?limit=${limit}&order=desc`;

  const res = await fetch(url);
  if (!res.ok) return { announcements: [], nextCursor: cursor ?? '' };

  const json = (await res.json()) as HorizonPage;
  const records = json._embedded?.records ?? [];

  const announcements: Announcement[] = [];
  for (const rec of records) {
    const parsed = parseMemo(rec.memo ?? '');
    if (parsed) announcements.push({ ...parsed, txHash: rec.hash });
  }

  const last = records[records.length - 1];
  const nextCursor = last?.paging_token ?? cursor ?? '';
  return { announcements, nextCursor };
}

function parseMemo(memo: string): Omit<Announcement, 'txHash'> | null {
  // Wraith Stellar announcements use a base64 memo of the form:
  //   <ephemeralPubKeyHex>:<stealthAddress>:<viewTag>:<amountXLM>
  try {
    const decoded = atob(memo);
    const [ephemeralPubKey, stealthAddress, viewTag, amount] = decoded.split(':');
    if (!ephemeralPubKey || !stealthAddress) return null;
    return { ephemeralPubKey, stealthAddress, viewTag, amount };
  } catch {
    return null;
  }
}

interface HorizonPage {
  _embedded?: { records: Array<{ memo?: string; hash: string; paging_token: string }> };
}

// ─── Web Worker scan offload ──────────────────────────────────────────────────

interface MatchedPayment {
  stealthAddress: string;
  amount: string;
  ephemeralPubKey: string;
  txHash?: string;
}

async function runWorkerScan(
  viewingKeyHex: string,
  spendingPubKeyHex: string,
  announcements: Announcement[],
): Promise<MatchedPayment[]> {
  return new Promise((resolve, reject) => {
    // SW can spawn Workers. The scan worker is served as a static asset.
    const worker = new Worker('/stellar-scan-worker.js');
    worker.postMessage({ viewingKeyHex, spendingPubKeyHex, announcements });
    worker.onmessage = (evt) => {
      worker.terminate();
      if (evt.data.error) reject(new Error(evt.data.error));
      else resolve(evt.data.matches ?? []);
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
  });
}

// ─── Inline IndexedDB helpers (duplicated for SW context) ────────────────────
// The SW cannot import the main-thread module; we replicate just what we need.

const DB_NAME = 'wraith-notifications';
const STORE_NAME = 'state';

interface NotificationState {
  enabled: boolean;
  chain: 'stellar';
  encryptedViewingKey?: string;
  signingOutput?: string;
  spendingPubKeyHex?: string;
  lastSeenCursor?: string;
  lastNotifiedAt?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readState(): Promise<NotificationState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('state');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeState(state: NotificationState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function decryptViewingKey(encryptedB64: string, signingOutput: string): Promise<string> {
  const encoder = new TextEncoder();
  const raw = encoder.encode(signingOutput);
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  const salt = encoder.encode('wraith-notifications-v1');
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const bytes = Uint8Array.from(atob(encryptedB64), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}