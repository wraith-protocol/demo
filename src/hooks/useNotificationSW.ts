import { useState, useEffect, useCallback, useRef } from 'react';
import { useNotificationsStore } from '@/stores/notificationsStore';
import {
  subscribeToRelay,
  unsubscribeFromRelay,
  testRelayConnectivity,
  DEFAULT_RELAY_URL,
} from '@/lib/pushRelay';
import { validateWorkerMessage, mainThreadRequestTracker } from '@/lib/workerProtocol';
import { getAppServiceWorkerRegistration } from '@/lib/swRegistration';

export interface WebPushState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  loading: boolean;
  error: string | null;
  relayUrl: string;
  relayReachable: boolean;
}

export interface UseNotificationSWReturn {
  state: WebPushState;
  requestPermission: () => Promise<boolean>;
  subscribe: (metaAddress: string, relayUrl?: string) => Promise<void>;
  unsubscribe: (metaAddress: string) => Promise<void>;
  testRelay: (relayUrl?: string) => Promise<boolean>;
  updateRelayUrl: (url: string) => void;
}

const STORAGE_KEY_RELAY_URL = 'wraith:push-relay-url';
const STORAGE_KEY_SUBSCRIBED = 'wraith:push-subscribed';

/**
 * Registers the Stellar notification service worker and manages Web Push
 * subscription lifecycle for stealth payment alerts.
 *
 * Features:
 * - Service worker registration and message handling
 * - Web Push subscription management
 * - Privacy-first relay integration (only meta-address hash)
 * - User-configurable relay URL
 * - Permission request and state management
 *
 * Should be mounted once at the app root level.
 */
export function useNotificationSW(): UseNotificationSWReturn {
  const addNotification = useNotificationsStore((state) => state.addNotification);
  const swRef = useRef<ServiceWorkerRegistration | null>(null);

  const [state, setState] = useState<WebPushState>({
    supported: false,
    permission: 'default',
    subscribed: false,
    loading: true,
    error: null,
    relayUrl: localStorage.getItem(STORAGE_KEY_RELAY_URL) || DEFAULT_RELAY_URL,
    relayReachable: false,
  });

  // Check browser support
  useEffect(() => {
    const supported =
      'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
    setState((prev) => ({ ...prev, supported, loading: false }));
  }, []);

  // Check subscription state from localStorage
  useEffect(() => {
    const subscribed = localStorage.getItem(STORAGE_KEY_SUBSCRIBED) === 'true';
    setState((prev) => ({ ...prev, subscribed }));
  }, []);

  // Check notification permission
  useEffect(() => {
    if (state.supported) {
      setState((prev) => ({ ...prev, permission: Notification.permission }));
    }
  }, [state.supported]);

  // Register service worker
  useEffect(() => {
    if (!state.supported) return;

    let cancelled = false;

    async function registerSW() {
      try {
        // Reuse the unified app worker instead of registering a second script at
        // the same scope, which would replace the PWA registration.
        const registration = await getAppServiceWorkerRegistration();
        if (!registration) throw new Error('App service worker is not registered');

        if (cancelled) return;

        swRef.current = registration;

        // Listen for permission changes
        if ('permissions' in navigator) {
          const permissionStatus = await (navigator as any).permissions.query({
            name: 'notifications',
          });
          permissionStatus.onchange = () => {
            setState((prev) => ({ ...prev, permission: Notification.permission }));
          };
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[wraith] SW registration failed:', err);
        setState((prev) => ({ ...prev, error: 'Service worker registration failed' }));
      }
    }

    registerSW();

    return () => {
      cancelled = true;
    };
  }, [state.supported]);

  // Listen for messages posted by the SW
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const validation = validateWorkerMessage(event.data);
      if (!validation.valid) {
        console.warn('[useNotificationSW] Ignoring invalid message from SW:', validation.reason);
        return;
      }

      const msg = validation.data;

      switch (msg.type) {
        case 'WRAITH_NOTIFICATION':
          if (msg.channel === 'wraith-notifications') {
            const { id, title, body, amount, asset, sender, url } = msg.payload;
            addNotification({
              id,
              title,
              body,
              timestamp: Date.now(),
              amount,
              asset,
              sender,
              data: { url },
            });
          }
          break;

        case 'VIEWING_KEY_REGISTERED':
        case 'VIEWING_KEY_UNREGISTERED':
        case 'PUSH_SUBSCRIPTION_REGISTERED':
        case 'PUSH_SUBSCRIPTION_UNREGISTERED':
        case 'STELLAR_SCAN_RECOVERY_COMPLETE':
          mainThreadRequestTracker.unregister(msg.requestId);
          break;

        case 'VIEWING_KEY_ERROR':
        case 'PUSH_SUBSCRIPTION_ERROR':
          console.error('[useNotificationSW] SW error:', msg.error);
          mainThreadRequestTracker.unregister(msg.requestId);
          break;

        case 'STELLAR_SCAN_RETENTION_GAP':
          console.warn('[useNotificationSW] Retention gap detected:', msg);
          break;

        case 'OFFLINE_QUEUE_FLUSH':
          console.log('[useNotificationSW] Offline queue flush requested');
          break;

        case 'NAVIGATE_TO_MATCH':
          console.log('[useNotificationSW] Navigate to match:', msg.stealthAddress);
          break;
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handler);
    };
  }, [addNotification]);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!state.supported) return false;

    try {
      const permission = await Notification.requestPermission();
      setState((prev) => ({ ...prev, permission }));
      return permission === 'granted';
    } catch (error) {
      console.error('Permission request failed:', error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Permission request failed',
      }));
      return false;
    }
  }, [state.supported]);

  // Subscribe to Web Push
  const subscribe = useCallback(
    async (metaAddress: string, relayUrl?: string) => {
      if (!state.supported || !swRef.current) {
        throw new Error('Web Push not supported or service worker not registered');
      }

      if (state.permission !== 'granted') {
        const granted = await requestPermission();
        if (!granted) {
          throw new Error('Notification permission denied');
        }
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        // Check if already subscribed
        const existingSubscription = await swRef.current.pushManager.getSubscription();
        if (existingSubscription) {
          console.log('[useNotificationSW] Already subscribed to push service');
        } else {
          // Subscribe to push service with VAPID key
          // Note: In production, this should be a proper VAPID public key
          // For demo purposes, we'll skip VAPID and use no-ops
          const subscription = await swRef.current.pushManager.subscribe({
            userVisibleOnly: true,
            // applicationServerKey: new Uint8Array([...]), // Add proper VAPID key in production
          });

          console.log('[useNotificationSW] Subscribed to push service');
        }

        // Get the subscription for relay registration
        const subscription = await swRef.current.pushManager.getSubscription();
        if (!subscription) {
          throw new Error('Failed to get push subscription');
        }

        // Subscribe to relay
        const relayUrlToUse = relayUrl || state.relayUrl;
        const response = await subscribeToRelay(subscription, metaAddress, {
          relayUrl: relayUrlToUse,
          chain: 'stellar',
        });

        if (!response.success) {
          throw new Error(response.error || 'Failed to subscribe to relay');
        }

        localStorage.setItem(STORAGE_KEY_SUBSCRIBED, 'true');
        setState((prev) => ({
          ...prev,
          subscribed: true,
          loading: false,
          error: null,
        }));
      } catch (error) {
        console.error('Subscription failed:', error);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Subscription failed',
        }));
        throw error;
      }
    },
    [state.supported, state.permission, state.relayUrl, requestPermission],
  );

  // Unsubscribe from Web Push
  const unsubscribe = useCallback(
    async (metaAddress: string) => {
      if (!swRef.current) return;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const subscription = await swRef.current.pushManager.getSubscription();
        if (subscription) {
          // Unsubscribe from relay
          await unsubscribeFromRelay(subscription, metaAddress, {
            relayUrl: state.relayUrl,
            chain: 'stellar',
          });

          // Unsubscribe from push service
          await subscription.unsubscribe();
        }

        localStorage.removeItem(STORAGE_KEY_SUBSCRIBED);
        mainThreadRequestTracker.clear();
        setState((prev) => ({
          ...prev,
          subscribed: false,
          loading: false,
          error: null,
        }));
      } catch (error) {
        console.error('Unsubscribe failed:', error);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Unsubscribe failed',
        }));
        throw error;
      }
    },
    [state.relayUrl],
  );

  // Test relay connectivity
  const testRelay = useCallback(
    async (relayUrl?: string): Promise<boolean> => {
      const relayUrlToUse = relayUrl || state.relayUrl;
      const result = await testRelayConnectivity({ relayUrl: relayUrlToUse });
      setState((prev) => ({ ...prev, relayReachable: result.reachable }));
      return result.reachable;
    },
    [state.relayUrl],
  );

  // Update relay URL
  const updateRelayUrl = useCallback((url: string) => {
    localStorage.setItem(STORAGE_KEY_RELAY_URL, url);
    setState((prev) => ({ ...prev, relayUrl: url }));
  }, []);

  return {
    state,
    requestPermission,
    subscribe,
    unsubscribe,
    testRelay,
    updateRelayUrl,
  };
}
