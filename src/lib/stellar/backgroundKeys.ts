/**
 * Key boundary between the app and the background-scanning service worker.
 *
 * The page seals the viewing material with a non-extractable AES-GCM key and
 * stores both in IndexedDB. The worker can decrypt with that key but nothing —
 * page or worker — can export it, and the spending seed never crosses the
 * boundary. Only what the scan needs is stored: viewing seed, spending public
 * key and spending scalar.
 */

export const VIEWING_KEY_DB_NAME = 'wraith-stellar-notifications';
export const VIEWING_KEY_DB_VERSION = 1;
export const VIEWING_KEY_STORE_NAME = 'viewing-keys';

const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** A payment the background scan matched. Deliberately holds no spend material. */
export interface StoredMatch {
  stealthAddress: string;
  ephemeralPubKey: string;
  caller: string;
  schemeId: number;
  ledger?: number;
  detectedAt: number;
}

export interface StoredViewingKey {
  publicKey: string;
  encryptedViewingKey: string;
  encryptedSpendingPubKey: string;
  encryptedSpendingScalar: string;
  /** Non-extractable AES-GCM key the three fields above are sealed with. */
  wrappingKey?: CryptoKey;
  lastScannedLedger?: number;
  matches?: StoredMatch[];
  timestamp: number;
  relayUrl?: string;
  metaAddressHash?: string;
  pushSubscription?: PushSubscriptionJSON;
}

export interface ViewingMaterial {
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
}

export type ViewingKeyErrorCode = 'no-wrapping-key' | 'decrypt-failed' | 'malformed';

export class ViewingKeyError extends Error {
  constructor(
    public readonly code: ViewingKeyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ViewingKeyError';
  }
}

// ── Crypto ─────────────────────────────────────────────────────────────────────

export function createWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new ViewingKeyError('malformed', 'Stored key material is not valid hex');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function seal(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toHex(combined);
}

async function open(key: CryptoKey, sealed: string): Promise<Uint8Array> {
  const combined = fromHex(sealed);
  if (combined.length <= IV_BYTES) {
    throw new ViewingKeyError('malformed', 'Stored key material is truncated');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, IV_BYTES) },
      key,
      combined.slice(IV_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new ViewingKeyError('decrypt-failed', 'Stored viewing key could not be decrypted');
  }
}

function expectLength(bytes: Uint8Array, name: string): Uint8Array {
  if (bytes.length !== KEY_BYTES) {
    throw new ViewingKeyError('malformed', `Stored ${name} has the wrong length`);
  }
  return bytes;
}

export async function sealViewingMaterial(
  wrappingKey: CryptoKey,
  material: ViewingMaterial,
): Promise<
  Pick<
    StoredViewingKey,
    'encryptedViewingKey' | 'encryptedSpendingPubKey' | 'encryptedSpendingScalar'
  >
> {
  const scalarBytes = fromHex(material.spendingScalar.toString(16).padStart(KEY_BYTES * 2, '0'));
  return {
    encryptedViewingKey: await seal(wrappingKey, material.viewingKey),
    encryptedSpendingPubKey: await seal(wrappingKey, material.spendingPubKey),
    encryptedSpendingScalar: await seal(wrappingKey, scalarBytes),
  };
}

/** Decrypts a stored record. Throws `ViewingKeyError` for anything unusable. */
export async function openViewingMaterial(record: StoredViewingKey): Promise<ViewingMaterial> {
  if (!record.wrappingKey) {
    throw new ViewingKeyError(
      'no-wrapping-key',
      'No decryption key stored for this viewing key — re-enable notifications from the app',
    );
  }
  if (!record.encryptedViewingKey || !record.encryptedSpendingPubKey) {
    throw new ViewingKeyError('malformed', 'Viewing key record is incomplete');
  }

  const viewingKey = expectLength(
    await open(record.wrappingKey, record.encryptedViewingKey),
    'viewing key',
  );
  const spendingPubKey = expectLength(
    await open(record.wrappingKey, record.encryptedSpendingPubKey),
    'spending public key',
  );
  const scalarBytes = expectLength(
    await open(record.wrappingKey, record.encryptedSpendingScalar),
    'spending scalar',
  );

  return { viewingKey, spendingPubKey, spendingScalar: BigInt(`0x${toHex(scalarBytes)}`) };
}

// ── IndexedDB ──────────────────────────────────────────────────────────────────

export function openViewingKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIEWING_KEY_DB_NAME, VIEWING_KEY_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(VIEWING_KEY_STORE_NAME)) {
        const store = db.createObjectStore(VIEWING_KEY_STORE_NAME, { keyPath: 'publicKey' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

export async function listViewingKeys(): Promise<StoredViewingKey[]> {
  const db = await openViewingKeyDb();
  try {
    return await new Promise<StoredViewingKey[]>((resolve, reject) => {
      const request = db
        .transaction([VIEWING_KEY_STORE_NAME], 'readonly')
        .objectStore(VIEWING_KEY_STORE_NAME)
        .getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? []);
    });
  } finally {
    db.close();
  }
}

/**
 * Read-modify-write of one record inside a single transaction, so a scan
 * committing its cursor and matches can't interleave with a re-registration.
 * `update` receives the current record (or undefined) and returns the record to
 * store, or null to leave the store untouched.
 */
export async function updateViewingKey(
  publicKey: string,
  update: (current: StoredViewingKey | undefined) => StoredViewingKey | null,
): Promise<void> {
  const db = await openViewingKeyDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([VIEWING_KEY_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(VIEWING_KEY_STORE_NAME);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));

      const read = store.get(publicKey);
      read.onsuccess = () => {
        const next = update(read.result as StoredViewingKey | undefined);
        if (next) store.put(next);
      };
    });
  } finally {
    db.close();
  }
}

/** Stores freshly sealed material, keeping the scan cursor and matches already on file. */
export function registerViewingKey(
  entry: Pick<
    StoredViewingKey,
    | 'publicKey'
    | 'encryptedViewingKey'
    | 'encryptedSpendingPubKey'
    | 'encryptedSpendingScalar'
    | 'wrappingKey'
  >,
): Promise<void> {
  return updateViewingKey(entry.publicKey, (current) => ({
    ...current,
    ...entry,
    timestamp: Date.now(),
  }));
}
