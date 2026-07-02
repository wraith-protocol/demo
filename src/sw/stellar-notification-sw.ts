/**
 * Service Worker for Stellar Payment Notifications
 * 
 * This service worker handles:
 * - Periodic background sync to scan for new stealth payments
 * - Showing notifications when new payments are detected
 * - Handling notification clicks to open the app
 * - Managing IndexedDB storage for encrypted viewing keys
 */

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
const DB_NAME = 'wraith-stellar-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'viewing-keys';
const SYNC_TAG = 'stellar-payment-scan';
const SYNC_INTERVAL_MINUTES = 15; // Check every 15 minutes

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

// IndexedDB helpers
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

async function getViewingKey(db: IDBDatabase, publicKey: string): Promise<StoredViewingKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(publicKey);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function updateLastScannedLedger(db: IDBDatabase, publicKey: string, ledger: number): Promise<void> {
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

// Stellar RPC helpers
async function fetchLatestLedger(): Promise<number> {
  const response = await fetch(STELLAR_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger',
    }),
  });
  
  const data = await response.json();
  return data.result?.sequence || 0;
}

async function fetchAnnouncementEvents(
  startLedger: number,
  contractId: string = ANNOUNCER_CONTRACT,
): Promise<{ events: any[]; latestLedger: number }> {
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

// Simple decryption using Web Crypto API
async function decryptData(encryptedHex: string, key: CryptoKey): Promise<Uint8Array> {
  const encryptedData = hexToBytes(encryptedHex);
  
  // Extract IV (first 12 bytes) and ciphertext
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  
  return new Uint8Array(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Import the Wraith SDK functions (will be loaded dynamically)
async function loadWraithSDK() {
  // In a real implementation, we'd need to bundle the SDK or use importScripts
  // For now, we'll implement a simplified version of the scanning logic
  return null;
}

// Show notification for new payment
async function showPaymentNotification(match: any): Promise<void> {
  const options: NotificationOptions = {
    body: `New stealth payment detected at ${match.stealthAddress.slice(0, 8)}...`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: match.stealthAddress,
    data: {
      stealthAddress: match.stealthAddress,
      timestamp: Date.now(),
    } as NotificationData,
    requireInteraction: false,
    silent: false,
  };
  
  await self.registration.showNotification('New Stellar Payment', options);
}

// Background sync handler
async function handleSync(event: ExtendableEvent): Promise<void> {
  if (!event.tag) return;
  
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
      // In a real implementation, we would:
      // 1. Decrypt the viewing key using the stored encryption key
      // 2. Scan for announcements since lastScannedLedger
      // 3. Match announcements against the viewing key
      // 4. Show notifications for new matches
      // 5. Update lastScannedLedger
      
      // For now, we'll implement a simplified version
      const startLedger = storedKey.lastScannedLedger || 1;
      const { events, latestLedger } = await fetchAnnouncementEvents(startLedger);
      
      if (events.length > 0) {
        // In production, we would decrypt and scan here
        // For demo purposes, we'll just show a notification if we found events
        console.log(`Found ${events.length} events for ${storedKey.publicKey}`);
        
        // TODO: Implement actual scanning with decrypted keys
        // This requires the Wraith SDK to be available in the service worker
      }
      
      await updateLastScannedLedger(db, storedKey.publicKey, latestLedger);
    }
    
    await db.close();
  } catch (error) {
    console.error('Background sync error:', error);
  }
}

// Service worker installation
self.addEventListener('install', (event) => {
  console.log('Stellar notification SW installing');
  event.waitUntil(self.skipWaiting());
});

// Service worker activation
self.addEventListener('activate', (event) => {
  console.log('Stellar notification SW activating');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Register periodic sync (Chrome only)
      (async () => {
        if ('periodicSync' in self.registration) {
          try {
            await (self.registration as any).periodicSync.register(SYNC_TAG, {
              minInterval: SYNC_INTERVAL_MINUTES * 60 * 1000,
            });
            console.log('Periodic sync registered');
          } catch (error) {
            console.error('Failed to register periodic sync:', error);
          }
        }
      })(),
    ]),
  );
});

// Handle background sync
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(handleSync(event));
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data as NotificationData;
  
  notification.close();
  
  // Open the app and navigate to the receive page
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes('/receive') || client.url.includes('/stellar')) {
          client.focus();
          // Post message to navigate to specific match
          client.postMessage({
            type: 'NAVIGATE_TO_MATCH',
            stealthAddress: data.stealthAddress,
          });
          return;
        }
      }
      
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow('/receive?match=' + data.stealthAddress);
      }
    }),
  );
});

// Handle messages from client
self.addEventListener('message', (event) => {
  const { type, publicKey, encryptedViewingKey, encryptedSpendingPubKey, encryptedSpendingScalar } = event.data;
  
  if (type === 'REGISTER_VIEWING_KEY') {
    event.waitUntil(
      (async () => {
        try {
          const db = await openDB();
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          
          const data: StoredViewingKey = {
            publicKey,
            encryptedViewingKey,
            encryptedSpendingPubKey,
            encryptedSpendingScalar,
            timestamp: Date.now(),
          };
          
          await new Promise<void>((resolve, reject) => {
            const request = store.put(data);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });
          
          await db.close();
          
          // Respond to client
          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_REGISTERED' });
        } catch (error) {
          console.error('Failed to register viewing key:', error);
          (event.source as Client)?.postMessage({ 
            type: 'VIEWING_KEY_ERROR', 
            error: error instanceof Error ? error.message : 'Unknown error' 
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
          
          await db.close();
          
          // Unregister periodic sync if no keys remain
          const allKeys = await new Promise<StoredViewingKey[]>((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readonly');
            const st = tx.objectStore(STORE_NAME);
            const req = st.getAll();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result || []);
          });
          
          if (allKeys.length === 0 && 'periodicSync' in self.registration) {
            await (self.registration as any).periodicSync.unregister(SYNC_TAG);
          }
          
          (event.source as Client)?.postMessage({ type: 'VIEWING_KEY_UNREGISTERED' });
        } catch (error) {
          console.error('Failed to unregister viewing key:', error);
        }
      })(),
    );
  }
  
  if (type === 'TRIGGER_SCAN') {
    // Manual trigger for testing
    event.waitUntil(handleSync(event as unknown as ExtendableEvent));
  }
});

// Handle push notifications (future enhancement)
self.addEventListener('push', (event) => {
  // Could be used for server-sent notifications
  // For now, we rely on periodic background sync
});

export {};
