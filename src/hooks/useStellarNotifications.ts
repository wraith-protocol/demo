/**
 * Hook for managing Stellar payment notifications
 * 
 * Handles:
 * - Service worker registration
 * - Notification permission requests
 * - Encrypted viewing key storage in IndexedDB
 * - Opt-in/opt-out flow
 * - Manual notification firing for demo
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StealthKeys } from '@wraith-protocol/sdk/chains/stellar';

const SW_PATH = '/sw/stellar-notification-sw.js';
const STORAGE_KEY_OPT_IN = 'wraith:stellar:notifications-opt-in';
const DB_NAME = 'wraith-stellar-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'viewing-keys';

export interface NotificationState {
  enabled: boolean;
  permission: NotificationPermission;
  swRegistered: boolean;
  supported: boolean;
  loading: boolean;
  error: string | null;
}

export interface UseStellarNotificationsReturn {
  state: NotificationState;
  requestPermission: () => Promise<boolean>;
  enableNotifications: () => Promise<void>;
  disableNotifications: () => Promise<void>;
  registerViewingKey: (publicKey: string, stealthKeys: StealthKeys) => Promise<void>;
  unregisterViewingKey: (publicKey: string) => Promise<void>;
  fireTestNotification: () => Promise<void>;
  isKeyRegistered: (publicKey: string) => Promise<boolean>;
}

export function useStellarNotifications(): UseStellarNotificationsReturn {
  const [state, setState] = useState<NotificationState>({
    enabled: false,
    permission: 'default',
    swRegistered: false,
    supported: false,
    loading: true,
    error: null,
  });

  const swRef = useRef<ServiceWorkerRegistration | null>(null);

  // Helper function to convert hex string to Uint8Array
  const hexToBytes = useCallback((hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }, []);

  // Check browser support
  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 
                      'Notification' in window && 
                      'indexedDB' in window;
    
    setState((prev: NotificationState) => ({ ...prev, supported, loading: false }));
  }, []);

  // Check opt-in state from localStorage
  useEffect(() => {
    const optIn = localStorage.getItem(STORAGE_KEY_OPT_IN) === 'true';
    setState((prev: NotificationState) => ({ ...prev, enabled: optIn }));
  }, []);

  // Register service worker
  useEffect(() => {
    if (!state.supported || !state.enabled) return;

    let cancelled = false;

    async function registerSW() {
      try {
        const registration = await navigator.serviceWorker.register(SW_PATH, {
          type: 'module',
        });
        
        if (cancelled) return;
        
        swRef.current = registration;
        setState((prev: NotificationState) => ({ 
          ...prev, 
          swRegistered: true,
          permission: Notification.permission,
        }));

        // Listen for permission changes
        if ('permissions' in navigator) {
          const permissionStatus = await (navigator as any).permissions.query({ name: 'notifications' });
          permissionStatus.onchange = () => {
            setState((prev: NotificationState) => ({ 
              ...prev, 
              permission: Notification.permission 
            }));
          };
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Service worker registration failed:', error);
        setState((prev: NotificationState) => ({ 
          ...prev, 
          error: error instanceof Error ? error.message : 'SW registration failed',
          swRegistered: false,
        }));
      }
    }

    registerSW();

    return () => {
      cancelled = true;
    };
  }, [state.supported, state.enabled]);

  // Encrypt data using Web Crypto API
  const encryptData = useCallback(async (data: Uint8Array, key: CryptoKey): Promise<string> => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data.buffer as ArrayBuffer,
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return Array.from(combined)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }, []);

  // Derive encryption key from wallet signature
  const deriveEncryptionKey = useCallback(async (signature: string): Promise<CryptoKey> => {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signature),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('wraith-stellar-notifications'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }, []);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!state.supported) return false;

    try {
      const permission = await Notification.requestPermission();
      setState((prev: NotificationState) => ({ ...prev, permission }));
      return permission === 'granted';
    } catch (error) {
      console.error('Permission request failed:', error);
      setState((prev: NotificationState) => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Permission request failed',
      }));
      return false;
    }
  }, [state.supported]);

  // Enable notifications
  const enableNotifications = useCallback(async () => {
    if (!state.supported) {
      setState((prev: NotificationState) => ({ ...prev, error: 'Notifications not supported' }));
      return;
    }

    const granted = await requestPermission();
    if (!granted) {
      setState((prev: NotificationState) => ({ ...prev, error: 'Permission denied' }));
      return;
    }

    localStorage.setItem(STORAGE_KEY_OPT_IN, 'true');
    setState((prev: NotificationState) => ({ ...prev, enabled: true, error: null }));
  }, [state.supported, requestPermission]);

  // Disable notifications
  const disableNotifications = useCallback(async () => {
    localStorage.removeItem(STORAGE_KEY_OPT_IN);
    setState((prev: NotificationState) => ({ ...prev, enabled: false, error: null }));
  }, []);

  // Register viewing key with service worker
  const registerViewingKey = useCallback(async (
    publicKey: string,
    stealthKeys: StealthKeys,
  ) => {
    if (!swRef.current || !state.enabled) {
      throw new Error('Service worker not registered or notifications disabled');
    }

    try {
      // Derive encryption key from spending scalar (this is wallet-derived)
      const scalarHex = stealthKeys.spendingScalar.toString(16).padStart(64, '0');
      const encryptionKey = await deriveEncryptionKey(scalarHex);

      // Encrypt the viewing key components
      const viewingKeyBytes = new TextEncoder().encode(stealthKeys.viewingKey);
      const spendingPubKeyBytes = stealthKeys.spendingPubKey;
      const spendingScalarBytes = hexToBytes(scalarHex);

      const encryptedViewingKey = await encryptData(viewingKeyBytes, encryptionKey);
      const encryptedSpendingPubKey = await encryptData(spendingPubKeyBytes, encryptionKey);
      const encryptedSpendingScalar = await encryptData(spendingScalarBytes, encryptionKey);

      // Send to service worker
      swRef.current.active?.postMessage({
        type: 'REGISTER_VIEWING_KEY',
        publicKey,
        encryptedViewingKey,
        encryptedSpendingPubKey,
        encryptedSpendingScalar,
      });

      // Also store in IndexedDB for backup
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'publicKey' });
          }
        };
      });

      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put({
        publicKey,
        encryptedViewingKey,
        encryptedSpendingPubKey,
        encryptedSpendingScalar,
        timestamp: Date.now(),
      });

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });

      db.close();
    } catch (error) {
      console.error('Failed to register viewing key:', error);
      throw error;
    }
  }, [state.enabled, deriveEncryptionKey, encryptData]);

  // Unregister viewing key
  const unregisterViewingKey = useCallback(async (publicKey: string) => {
    if (!swRef.current) return;

    try {
      swRef.current.active?.postMessage({
        type: 'UNREGISTER_VIEWING_KEY',
        publicKey,
      });

      // Also remove from IndexedDB
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(publicKey);

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });

      db.close();
    } catch (error) {
      console.error('Failed to unregister viewing key:', error);
    }
  }, []);

  // Check if key is registered
  const isKeyRegistered = useCallback(async (publicKey: string): Promise<boolean> => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      const result = await new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(publicKey);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(!!request.result);
      });

      db.close();
      return result;
    } catch (error) {
      console.error('Failed to check key registration:', error);
      return false;
    }
  }, []);

  // Fire test notification for demo
  const fireTestNotification = useCallback(async () => {
    if (!state.swRegistered || state.permission !== 'granted') {
      throw new Error('Service worker not registered or permission not granted');
    }

    if (!swRef.current) {
      throw new Error('Service worker not available');
    }

    // Trigger manual scan in service worker
    swRef.current.active?.postMessage({
      type: 'TRIGGER_SCAN',
    });

    // Also show immediate test notification
    if (swRef.current) {
      await swRef.current.showNotification('Test Notification', {
        body: 'This is a test notification from Wraith Stellar notifications',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: 'test',
        data: {
          stealthAddress: 'TEST123456789',
          timestamp: Date.now(),
        },
      });
    }
  }, [state.swRegistered, state.permission]);

  return {
    state,
    requestPermission,
    enableNotifications,
    disableNotifications,
    registerViewingKey,
    unregisterViewingKey,
    fireTestNotification,
    isKeyRegistered,
  };
}
