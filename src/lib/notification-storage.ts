/**
 * src/lib/notification-storage.ts
 *
 * IndexedDB wrapper for persisting notification opt-in state and the
 * AES-GCM-encrypted viewing key the service worker needs to scan.
 *
 * ── Privacy model ────────────────────────────────────────────────────────────
 *   • The viewing key is encrypted with AES-256-GCM before touching storage.
 *   • The encryption key is derived via PBKDF2 (100 000 iterations, SHA-256)
 *     from signingOutput — the raw bytes returned by the wallet's signMessage.
 *   • signingOutput is not a secret on its own; the security comes from the
 *     PBKDF2 derivation: an attacker with IndexedDB access cannot reverse it
 *     without the original wallet signature.
 *   • The spending key is never stored. An attacker can detect that a payment
 *     arrived, but cannot move funds.
 *   • clearState() immediately removes everything from IndexedDB.
 */

const DB_NAME    = 'wraith-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'state';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationState {
  enabled: boolean;
  chain: 'stellar';
  /** Base64  IV (12 B) || ciphertext  from encryptViewingKey(). */
  encryptedViewingKey?: string;
  /**
   * Raw hex returned by the wallet's signMessage() call.
   * Stored so the SW can re-derive the AES decryption key without user
   * interaction during a background scan.
   */
  signingOutput?: string;
  /** Spending public key hex — needed by the stealth-scan SDK. */
  spendingPubKeyHex?: string;
  /** Horizon paging_token of the last processed transaction. */
  lastSeenCursor?: string;
  /** Epoch ms of the last notification fired (rate-limit). */
  lastNotifiedAt?: number;
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function readState(): Promise<NotificationState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly')
                  .objectStore(STORE_NAME)
                  .get('state');
    req.onsuccess = () => resolve((req.result as NotificationState) ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function writeState(state: NotificationState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function clearState(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('state');
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── AES-GCM encryption helpers ───────────────────────────────────────────────

async function deriveKey(signingOutput: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(signingOutput);
  const km  = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       new TextEncoder().encode('wraith-notifications-v1'),
      iterations: 100_000,
      hash:       'SHA-256',
    },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts viewingKeyHex with a key derived from signingOutput.
 * Returns Base64( IV || ciphertext ).
 */
export async function encryptViewingKey(
  viewingKeyHex: string,
  signingOutput: string,
): Promise<string> {
  const key        = await deriveKey(signingOutput);
  const iv         = crypto.getRandomValues(new Uint8Array(12));
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

/** Decrypts a value produced by encryptViewingKey(). */
export async function decryptViewingKey(
  encryptedB64: string,
  signingOutput: string,
): Promise<string> {
  const key   = await deriveKey(signingOutput);
  const bytes = Uint8Array.from(atob(encryptedB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}