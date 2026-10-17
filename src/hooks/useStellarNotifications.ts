/**
 * Hook for managing Stellar payment notifications
 *
 * Handles:
 * - Service worker registration
 * - Notification permission requests
 * - Sealing the minimum scan material (viewing key + spending PUBLIC key)
 * - Opt-in/opt-out flow
 * - Manual notification firing for demo
 *
 * The spending scalar is never read here, never sent to a worker, never stored.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import { createIdbScanKeyBackend } from '../sw/idbScanKeyBackend';
import {
  hasScanKey,
  removeScanKey,
  sealScanKey,
  toScanKeyMaterial,
  wipeScanKeyMaterial,
} from '../sw/scanKeyStore';

const STORAGE_KEY_OPT_IN = 'wraith:stellar:notifications-opt-in';

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

  // Check browser support
  useEffect(() => {
    const supported =
      'serviceWorker' in navigator && 'Notification' in window && 'indexedDB' in window;

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
        // app-sw.ts is the registered worker and contains the scan/notification handlers.
        const registration = await navigator.serviceWorker.ready;

        if (cancelled) return;

        swRef.current = registration;
        setState((prev: NotificationState) => ({
          ...prev,
          swRegistered: true,
          permission: Notification.permission,
        }));

        // Listen for permission changes
        if ('permissions' in navigator) {
          const permissionStatus = await (navigator as any).permissions.query({
            name: 'notifications',
          });
          permissionStatus.onchange = () => {
            setState((prev: NotificationState) => ({
              ...prev,
              permission: Notification.permission,
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

  // Register (or re-register after a lock) the scan material for an account.
  const registerViewingKey = useCallback(
    async (publicKey: string, stealthKeys: StealthKeys) => {
      if (!swRef.current || !state.enabled) {
        throw new Error('Service worker not registered or notifications disabled');
      }

      // Copies only the viewing key and the spending PUBLIC key.
      const material = toScanKeyMaterial(stealthKeys);
      try {
        // Sealed straight into IndexedDB; nothing secret goes through postMessage.
        await sealScanKey(createIdbScanKeyBackend(), publicKey, material);
        swRef.current.active?.postMessage({ type: 'REGISTER_VIEWING_KEY', publicKey });
      } catch (error) {
        console.error('Failed to register viewing key:', error);
        throw error;
      } finally {
        wipeScanKeyMaterial(material);
      }
    },
    [state.enabled],
  );

  // Key removal: wipes the sealed blob and its wrapping key.
  const unregisterViewingKey = useCallback(async (publicKey: string) => {
    try {
      await removeScanKey(createIdbScanKeyBackend(), publicKey);
      swRef.current?.active?.postMessage({ type: 'UNREGISTER_VIEWING_KEY', publicKey });
    } catch (error) {
      console.error('Failed to unregister viewing key:', error);
    }
  }, []);

  // Check if key is registered
  const isKeyRegistered = useCallback(async (publicKey: string): Promise<boolean> => {
    try {
      return await hasScanKey(createIdbScanKeyBackend(), publicKey);
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
