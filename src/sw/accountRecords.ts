// Fields older builds wrote into the 'viewing-keys' store. None of them may survive.
const LEGACY_SECRET_FIELDS = [
  'encryptedViewingKey',
  'encryptedSpendingPubKey',
  'encryptedSpendingScalar',
] as const;

export function stripLegacySecretFields<T extends object>(
  record: T,
): { record: T; changed: boolean } {
  const copy = { ...record } as Record<string, unknown>;
  let changed = false;
  for (const field of LEGACY_SECRET_FIELDS) {
    if (field in copy) {
      delete copy[field];
      changed = true;
    }
  }
  return { record: copy as T, changed };
}

function finish(tx: IDBTransaction, resolve: () => void, reject: (e: unknown) => void) {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
}

/** Registers an account for scanning without secrets; keeps cursor + push data. */
export function upsertAccountRecord(
  db: IDBDatabase,
  storeName: string,
  publicKey: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const read = store.get(publicKey);
    read.onsuccess = () => {
      const { record } = stripLegacySecretFields((read.result ?? {}) as object);
      store.put({ ...record, publicKey, timestamp: Date.now() });
    };
    finish(tx, resolve, reject);
  });
}

/** One-time cleanup of records written by older builds. Returns how many were changed. */
export function scrubLegacySpendingMaterial(db: IDBDatabase, storeName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    let scrubbed = 0;
    const cursorRequest = tx.objectStore(storeName).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const { record, changed } = stripLegacySecretFields(cursor.value as object);
      if (changed) {
        cursor.update(record);
        scrubbed++;
      }
      cursor.continue();
    };
    finish(tx, () => resolve(scrubbed), reject);
  });
}
