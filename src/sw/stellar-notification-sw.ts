/**
 * src/sw/stellar-notification-sw.ts
 *
 * Compiled to  public/stellar-notification-sw.js  by scripts/build-sw.sh
 * (or automatically by vite-plugin-pwa in injectManifest mode).
 *
 * Handles three event types:
 *   'periodicsync'      — Periodic Background Sync (Chrome / Edge 80+)
 *   'message'           — Fallback ping from the page (Firefox, iOS Safari)
 *   'notificationclick' — Opens / focuses the Receive page
 *
 * Browser compatibility (also disclosed in StellarNotificationToggle):
 *   Chrome / Edge 80+  Full PBS — scans fire even when tab is closed
 *   Firefox            No PBS   — message-ping loop while tab is open
 *   iOS Safari 16.4+   Limited  — PBS fires infrequently; PWA required
 *
 * Privacy model:
 *   The viewing key is decrypted in memory during the scan and discarded
 *   immediately after. The spending key is never stored.
 *   See src/lib/notification-storage.ts for the encryption details.
 */

/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const self: ServiceWorkerGlobalScope;

const SYNC_TAG       = 'wraith-stellar-scan';
const HORIZON_BASE   = 'https://horizon-testnet.stellar.org';
const ANNOUNCER_ACCT = 'GDWUE5ANKLFRQFANM2EL5MBJBXBSMV7HTFZZVGXG6QT4RJOKQVFPBIM'; // testnet
const RATE_LIMIT_MS  = 5 * 60 * 1000; // 5 min per chain
const RECEIVE_PAGE   = '/receive';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install',  ()    => { self.skipWaiting(); });
self.addEventListener('activate', (evt) => { evt.waitUntil(self.clients.claim()); });

// ─── Periodic Background Sync ─────────────────────────────────────────────────

self.addEventListener('periodicsync', (evt) => {
  if ((evt as any).tag === SYNC_TAG) {
    (evt as any).waitUntil(runScan());
  }
});

// ─── Message-loop fallback ────────────────────────────────────────────────────

self.addEventListener('message', (evt) => {
  const type = evt.data?.type as string | undefined;
  if (type === 'WRAITH_SCAN_PING' || type === 'WRAITH_SCAN_NOW') {
    evt.waitUntil(runScan());
  }
});

// ─── Notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', (evt) => {
  evt.notification.close();
  const targetUrl = (evt.notification.data?.url as string | undefined) ?? RECEIVE_PAGE;
  evt.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (c.url.includes(RECEIVE_PAGE) && 'focus' in c) {
            return (c as WindowClient).focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

// ─── Core scan ────────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  try {
    const state = await readState();
    if (!state?.enabled || !state.encryptedViewingKey || !state.signingOutput) return;

    // Decrypt viewing key in memory — discarded after this function returns.
    const viewingKeyHex = await decryptViewingKey(
      state.encryptedViewingKey,
      state.signingOutput,
    );
    if (!viewingKeyHex) return;

    const now        = Date.now();
    const canNotify  = !state.lastNotifiedAt || now - state.lastNotifiedAt >= RATE_LIMIT_MS;

    await scanAndMaybeNotify(viewingKeyHex, state, canNotify);
  } catch (err) {
    console.error('[wraith-sw] scan error', err);
  }
}

async function scanAndMaybeNotify(
  viewingKeyHex: string,
  state: NotificationState,
  canNotify: boolean,
): Promise<void> {
  const { announcements, nextCursor } = await fetchAnnouncements(state.lastSeenCursor);

  // Always advance the cursor even when there are no matches,
  // so we don't re-scan old transactions on the next wake-up.
  if (announcements.length === 0) {
    if (nextCursor && nextCursor !== state.lastSeenCursor) {
      await writeState({ ...state, lastSeenCursor: nextCursor });
    }
    return;
  }

  // Offload EC math to a Web Worker to avoid blocking the SW event loop.
  const matches = await runWorkerScan(
    viewingKeyHex,
    state.spendingPubKeyHex ?? '',
    announcements,
  );

  // Always persist the new cursor.
  const newState = { ...state, lastSeenCursor: nextCursor };
  await writeState(newState);

  if (!canNotify || matches.length === 0) return;

  const isSingle = matches.length === 1;
  const title    = isSingle
    ? 'Wraith — Payment received'
    : `Wraith — ${matches.length} new payments`;
  const body     = isSingle
    ? buildBody(matches[0])
    : `${matches.length} Stellar (XLM) payments to your stealth address`;

  await self.registration.showNotification(title, {
    body,
    icon:  '/wraith-192.png',
    badge: '/wraith-badge-96.png',
    tag:   `wraith-stellar-${Date.now()}`,
    data: {
      url:           RECEIVE_PAGE,
      chain:         'stellar',
      stealthAddress: matches[0].stealthAddress,
    },
  });

  await writeState({ ...newState, lastNotifiedAt: Date.now() });
}

function buildBody(match: MatchedPayment): string {
  const addr   = match.stealthAddress
    ? `${match.stealthAddress.slice(0, 6)}…${match.stealthAddress.slice(-4)}`
    : 'stealth address';
  const amount = match.amount ? `${match.amount} XLM` : 'XLM';
  return `Stellar payment of ${amount} to your stealth address ${addr}`;
}

// ─── Horizon fetcher ──────────────────────────────────────────────────────────

interface Announcement {
  ephemeralPubKey: string;
  stealthAddress:  string;
  viewTag:         string;
  amount?:         string;
  txHash?:         string;
}

interface HorizonPage {
  _embedded?: {
    records: Array<{ memo?: string; hash: string; paging_token: string }>;
  };
}

async function fetchAnnouncements(
  cursor?: string,
): Promise<{ announcements: Announcement[]; nextCursor: string }> {
  const limit = 50;
  const qs    = cursor
    ? `cursor=${encodeURIComponent(cursor)}&limit=${limit}&order=asc`
    : `limit=${limit}&order=desc`;
  const url   = `${HORIZON_BASE}/accounts/${ANNOUNCER_ACCT}/transactions?${qs}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { announcements: [], nextCursor: cursor ?? '' };
  }
  if (!res.ok) return { announcements: [], nextCursor: cursor ?? '' };

  const json    = (await res.json()) as HorizonPage;
  const records = json._embedded?.records ?? [];

  const announcements: Announcement[] = records
    .map((rec) => {
      const parsed = parseMemo(rec.memo ?? '');
      return parsed ? { ...parsed, txHash: rec.hash } : null;
    })
    .filter((a): a is Announcement => a !== null);

  const last       = records[records.length - 1];
  const nextCursor = last?.paging_token ?? cursor ?? '';
  return { announcements, nextCursor };
}

function parseMemo(memo: string): Omit<Announcement, 'txHash'> | null {
  // Wraith Stellar memos are base64-encoded:
  //   <ephemeralPubKeyHex>:<stealthAddress>:<viewTag>:<amountXLM>
  try {
    const decoded = atob(memo);
    const [ephemeralPubKey, stealthAddress, viewTag, amount] = decoded.split(':');
    if (!ephemeralPubKey || !stealthAddress) return null;
    return { ephemeralPubKey, stealthAddress, viewTag: viewTag ?? '', amount };
  } catch {
    return null;
  }
}

// ─── Web Worker scan offload ──────────────────────────────────────────────────

interface MatchedPayment {
  stealthAddress:  string;
  amount:          string;
  ephemeralPubKey: string;
  txHash?:         string;
}

function runWorkerScan(
  viewingKeyHex:    string,
  spendingPubKeyHex: string,
  announcements:    Announcement[],
): Promise<MatchedPayment[]> {
  return new Promise((resolve, reject) => {
    // /stellar-scan-worker.js is a pre-built static asset (see build-sw.sh).
    const worker = new Worker('/stellar-scan-worker.js');
    const timer  = setTimeout(() => {
      worker.terminate();
      reject(new Error('[wraith-sw] scan worker timed out'));
    }, 30_000);

    worker.onmessage = (evt) => {
      clearTimeout(timer);
      worker.terminate();
      if (evt.data.error) reject(new Error(evt.data.error));
      else resolve((evt.data.matches as MatchedPayment[]) ?? []);
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    };

    worker.postMessage({ viewingKeyHex, spendingPubKeyHex, announcements });
  });
}

// ─── Inline IndexedDB + crypto (cannot import main-thread modules in SW) ──────

const DB_NAME    = 'wraith-notifications';
const STORE_NAME = 'state';

interface NotificationState {
  enabled:              boolean;
  chain:                'stellar';
  encryptedViewingKey?: string;
  signingOutput?:       string;
  spendingPubKeyHex?:   string;
  lastSeenCursor?:      string;
  lastNotifiedAt?:      number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function readState(): Promise<NotificationState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly')
                  .objectStore(STORE_NAME)
                  .get('state');
    req.onsuccess = () => resolve((req.result as NotificationState) ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function writeState(state: NotificationState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function decryptViewingKey(
  encryptedB64:  string,
  signingOutput: string,
): Promise<string> {
  const raw = new TextEncoder().encode(signingOutput);
  const km  = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       new TextEncoder().encode('wraith-notifications-v1'),
      iterations: 100_000,
      hash:       'SHA-256',
    },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const bytes = Uint8Array.from(atob(encryptedB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}