/**
 * notification-storage.ts
 *
 * IndexedDB wrapper for persisting notification preferences and the encrypted
 * viewing key needed by the service worker's background scanner.
 *
 * PRIVACY NOTICE (shown to user at opt-in):
 *   Enabling notifications stores an encrypted copy of your Stellar viewing
 *   key in IndexedDB so the background service worker can scan for payments
 *   while the tab is closed. The key is encrypted with AES-GCM using a key
 *   derived from a wallet-signed message — it never leaves your device
 *   unencrypted. Disabling notifications immediately removes it from storage.
 */

const DB_NAME = 'wraith-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'state';

export interface NotificationState {
  enabled: boolean;
  chain: 'stellar';
  // Base64-encoded IV + ciphertext produced by encryptViewingKey()
  encryptedViewingKey?: string;
  // Last ledger/cursor we scanned up to (avoids re-scanning old announcements)
  lastSeenCursor?: string;
  // Epoch ms of the last notification fire per chain (rate-limiting)
  lastNotifiedAt?: number;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readState(): Promise<NotificationState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('state');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function writeState(state: NotificationState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearState(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Encryption helpers ───────────────────────────────────────────────────────

/**
 * Derives a 256-bit AES-GCM key from an arbitrary bytes input (e.g. a
 * wallet-signed message). Uses PBKDF2 with a fixed salt so the derivation is
 * deterministic across page reloads — the user can always re-derive it by
 * signing the same message again.
 */
async function deriveKey(signedMessageHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const raw = encoder.encode(signedMessageHex);
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, [
    'deriveKey',
  ]);
  const salt = encoder.encode('wraith-notifications-v1');
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Returns a Base64 string of  IV (12 bytes) || ciphertext. */
export async function encryptViewingKey(
  viewingKeyHex: string,
  signedMessageHex: string,
): Promise<string> {
  const key = await deriveKey(signedMessageHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(viewingKeyHex),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/** Returns the original hex viewing key. */
export async function decryptViewingKey(
  encryptedB64: string,
  signedMessageHex: string,
): Promise<string> {
  const key = await deriveKey(signedMessageHex);
  const bytes = Uint8Array.from(atob(encryptedB64), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}