import { generateRequestId, validateWorkerMessage } from '@/lib/workerProtocol';
import type {
  IdbEntry,
  LocalDataBackends,
  LocalDataCaches,
  LocalDataIdb,
  LocalDataWorker,
  WorkerClearRequest,
} from './localData';

/** How long the page waits for the service worker before clearing its records itself. */
export const WORKER_ACK_TIMEOUT_MS = 5000;

/**
 * Opens a database only if it already exists. Opening an unknown name would
 * otherwise create an empty version-1 database, and a later `open(name, 1)` by
 * its real owner would then skip the upgrade that creates its object stores.
 */
function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let created = false;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => (created ? resolve(null) : reject(request.error));
  });
}

async function withStore<T>(
  database: string,
  store: string,
  mode: IDBTransactionMode,
  fallback: T,
  work: (objectStore: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await openExisting(database);
  if (!db) return fallback;
  try {
    if (!db.objectStoreNames.contains(store)) return fallback;
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([store], mode);
      let result = fallback;
      work(tx.objectStore(store), (value) => {
        result = value;
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createBrowserIdb(): LocalDataIdb {
  return {
    entries: (database, store) =>
      withStore<IdbEntry[]>(database, store, 'readonly', [], (objectStore, done) => {
        const entries: IdbEntry[] = [];
        const cursor = objectStore.openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) {
            done(entries);
            return;
          }
          // Wrapping keys are non-extractable CryptoKeys; only the key is needed.
          entries.push({ key: String(current.key), value: current.value });
          current.continue();
        };
      }),
    delete: (database, store, keys) =>
      withStore<void>(database, store, 'readwrite', undefined, (objectStore) => {
        for (const key of keys) objectStore.delete(key);
      }),
    clear: (database, store) =>
      withStore<void>(database, store, 'readwrite', undefined, (objectStore) => {
        objectStore.clear();
      }),
  };
}

export function createBrowserCaches(): LocalDataCaches {
  const available = () => typeof caches !== 'undefined';
  return {
    names: async () => (available() ? caches.keys() : []),
    urls: async (name) => {
      if (!available() || !(await caches.has(name))) return [];
      const cache = await caches.open(name);
      return (await cache.keys()).map((request) => request.url);
    },
    deleteUrls: async (name, urls) => {
      if (!available() || !(await caches.has(name))) return;
      const cache = await caches.open(name);
      for (const url of urls) await cache.delete(url);
    },
    deleteCache: async (name) => {
      if (available()) await caches.delete(name);
    },
  };
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
}

export function createBrowserWorker(timeoutMs: number = WORKER_ACK_TIMEOUT_MS): LocalDataWorker {
  return {
    clear: async (request: WorkerClearRequest) => {
      const worker = (await activeRegistration())?.active;
      if (!worker) return false;
      const requestId = generateRequestId();
      const channel = new MessageChannel();
      return new Promise<boolean>((resolve) => {
        const finish = (acknowledged: boolean) => {
          clearTimeout(timer);
          channel.port1.close();
          resolve(acknowledged);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        channel.port1.onmessage = (event: MessageEvent) => {
          const message = validateWorkerMessage(event.data);
          finish(
            message.valid &&
              message.data.type === 'LOCAL_DATA_CLEARED' &&
              message.data.requestId === requestId,
          );
        };
        worker.postMessage({ type: 'CLEAR_LOCAL_DATA', requestId, ...request }, [channel.port2]);
      });
    },
    unsubscribePush: async () => {
      const registration = await activeRegistration();
      const subscription = await registration?.pushManager?.getSubscription().catch(() => null);
      if (!subscription) return false;
      return subscription.unsubscribe().catch(() => false);
    },
  };
}

export function createBrowserLocalDataBackends(): LocalDataBackends {
  return {
    storage: localStorage,
    idb: createBrowserIdb(),
    caches: createBrowserCaches(),
    worker: createBrowserWorker(),
    withLock:
      typeof navigator !== 'undefined' && navigator.locks
        ? <T>(name: string, work: () => Promise<T>) =>
            navigator.locks.request(name, { mode: 'exclusive' }, work) as Promise<T>
        : undefined,
  };
}
