export const NOTIFICATION_STORE_NAME = 'notification-events';
export const MAX_STORED_NOTIFICATION_IDS = 1000;

interface StoredNotificationId {
  id: string;
  timestamp: number;
}

export function createNotificationStore(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(NOTIFICATION_STORE_NAME)) {
    const store = db.createObjectStore(NOTIFICATION_STORE_NAME, { keyPath: 'id' });
    store.createIndex('timestamp', 'timestamp', { unique: false });
  }
}

export function claimNotificationId(db: IDBDatabase, id: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(NOTIFICATION_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(NOTIFICATION_STORE_NAME).add({
      id,
      timestamp: Date.now(),
    } satisfies StoredNotificationId);
    let claimed = true;

    request.onerror = (event) => {
      if (request.error?.name === 'ConstraintError') {
        event.preventDefault();
        event.stopPropagation();
        claimed = false;
      }
    };
    transaction.oncomplete = () => resolve(claimed);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
}

export function releaseNotificationId(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(NOTIFICATION_STORE_NAME, 'readwrite');
    transaction.objectStore(NOTIFICATION_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function pruneNotificationIds(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(NOTIFICATION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(NOTIFICATION_STORE_NAME);
    const countRequest = store.count();

    countRequest.onsuccess = () => {
      let remaining = countRequest.result - MAX_STORED_NOTIFICATION_IDS;
      if (remaining <= 0) return;
      const cursorRequest = store.index('timestamp').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= 0) return;
        cursor.delete();
        remaining -= 1;
        cursor.continue();
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
