import type { ScanKeyBackend, SealedScanKey } from './scanKeyStore';

// Dedicated DB so page and both service workers share one schema/version.
const DB_NAME = 'wraith-scan-keys';
const DB_VERSION = 1;
const SEALED_STORE = 'sealed-keys';
const WRAPPING_STORE = 'wrapping-keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SEALED_STORE)) {
        db.createObjectStore(SEALED_STORE, { keyPath: 'publicKey' });
      }
      if (!db.objectStoreNames.contains(WRAPPING_STORE)) db.createObjectStore(WRAPPING_STORE);
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withDb<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

export function createIdbScanKeyBackend(): ScanKeyBackend {
  return {
    getRecord: (publicKey) =>
      withDb((db) =>
        result<SealedScanKey | undefined>(
          db.transaction(SEALED_STORE).objectStore(SEALED_STORE).get(publicKey),
        ),
      ),
    getWrappingKey: (publicKey) =>
      withDb((db) =>
        result<CryptoKey | undefined>(
          db.transaction(WRAPPING_STORE).objectStore(WRAPPING_STORE).get(publicKey),
        ),
      ),
    putSealed: (record, wrappingKey) =>
      withDb(async (db) => {
        const tx = db.transaction([SEALED_STORE, WRAPPING_STORE], 'readwrite');
        tx.objectStore(SEALED_STORE).put(record);
        tx.objectStore(WRAPPING_STORE).put(wrappingKey, record.publicKey);
        await done(tx);
      }),
    deleteWrappingKey: (publicKey) =>
      withDb(async (db) => {
        const tx = db.transaction(WRAPPING_STORE, 'readwrite');
        tx.objectStore(WRAPPING_STORE).delete(publicKey);
        await done(tx);
      }),
    clearWrappingKeys: () =>
      withDb(async (db) => {
        const tx = db.transaction(WRAPPING_STORE, 'readwrite');
        tx.objectStore(WRAPPING_STORE).clear();
        await done(tx);
      }),
    remove: (publicKey) =>
      withDb(async (db) => {
        const tx = db.transaction([SEALED_STORE, WRAPPING_STORE], 'readwrite');
        tx.objectStore(SEALED_STORE).delete(publicKey);
        tx.objectStore(WRAPPING_STORE).delete(publicKey);
        await done(tx);
      }),
  };
}
