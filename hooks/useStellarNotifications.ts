/**
 * useStellarNotifications.ts
 *
 * Manages the full lifecycle of browser push notifications for Stellar
 * stealth payments:
 *   1. Reads/writes opt-in state from IndexedDB.
 *   2. Requests Notification permission when the user enables.
 *   3. Registers (or unregisters) the Periodic Background Sync tag.
 *   4. Falls back to a 5-minute message-ping loop when PBS is unavailable.
 *   5. Encrypts the viewing key with AES-GCM before persisting it.
 *
 * Usage:
 *   const notif = useStellarNotifications();
 *   // notif.enabled, notif.permissionState, notif.enable(), notif.disable()
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearState,
  encryptViewingKey,
  readState,
  writeState,
} from '@/lib/notification-storage';

const SYNC_TAG = 'wraith-stellar-scan';
const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SW_PATH = '/stellar-notification-sw.js';

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface StellarNotificationHook {
  /** Whether the user has opted in and permission is granted. */
  enabled: boolean;
  /** Raw Notification.permission value, or 'unsupported'. */
  permissionState: PermissionState;
  /** Whether Periodic Background Sync is supported (Chrome/Edge). */
  pbsSupported: boolean;
  /** True while enable() is resolving (permission prompt in progress). */
  loading: boolean;
  /** Error string if the last enable() failed. */
  error: string | null;
  /**
   * Opts the user in. Requires the already-derived viewing key and the
   * wallet signing output used to encrypt it.
   */
  enable: (opts: {
    viewingKeyHex: string;
    spendingPubKeyHex: string;
    /** The raw hex string returned by signMessage() — used as KDF input. */
    signingOutput: string;
    lastSeenCursor?: string;
  }) => Promise<void>;
  /** Opts the user out — removes keys from storage, unregisters sync. */
  disable: () => Promise<void>;
}

export function useStellarNotifications(): StellarNotificationHook {
  const [enabled, setEnabled] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('default');
  const [pbsSupported, setPbsSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      if (!('Notification' in window)) {
        setPermissionState('unsupported');
        return;
      }
      setPermissionState(Notification.permission as PermissionState);

      // Check PBS availability
      const reg = await getSwRegistration();
      if (reg && 'periodicSync' in reg) setPbsSupported(true);

      // Restore persisted state
      const state = await readState();
      if (state?.enabled && Notification.permission === 'granted') {
        setEnabled(true);
        startPingLoop();
      }
    };
    init().catch(console.error);

    return () => stopPingLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Enable ────────────────────────────────────────────────────────────────

  const enable = useCallback(
    async ({
      viewingKeyHex,
      spendingPubKeyHex,
      signingOutput,
      lastSeenCursor,
    }: {
      viewingKeyHex: string;
      spendingPubKeyHex: string;
      signingOutput: string;
      lastSeenCursor?: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        if (!('Notification' in window)) throw new Error('Notifications not supported');

        // 1. Request permission
        const perm = await Notification.requestPermission();
        setPermissionState(perm as PermissionState);
        if (perm !== 'granted') {
          throw new Error('Permission not granted. Change it in browser settings.');
        }

        // 2. Register SW
        const reg = await registerSw();
        if (!reg) throw new Error('Service worker registration failed');

        // 3. Register Periodic Background Sync (best-effort)
        if ('periodicSync' in reg) {
          try {
            await (reg as any).periodicSync.register(SYNC_TAG, {
              minInterval: PING_INTERVAL_MS,
            });
          } catch {
            // PBS permission denied or not supported — fall back to ping loop
          }
        }

        // 4. Encrypt and persist viewing key
        const encryptedViewingKey = await encryptViewingKey(viewingKeyHex, signingOutput);
        await writeState({
          enabled: true,
          chain: 'stellar',
          encryptedViewingKey,
          signingOutput, // stored so SW can re-derive decryption key
          spendingPubKeyHex,
          lastSeenCursor,
        });

        // 5. Kick off an immediate scan
        if (reg.active) {
          reg.active.postMessage({ type: 'WRAITH_SCAN_NOW' });
        }

        setEnabled(true);
        startPingLoop();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ─── Disable ───────────────────────────────────────────────────────────────

  const disable = useCallback(async () => {
    setLoading(true);
    try {
      stopPingLoop();
      await clearState();

      const reg = await getSwRegistration();
      if (reg && 'periodicSync' in reg) {
        try {
          await (reg as any).periodicSync.unregister(SYNC_TAG);
        } catch {
          // ignore — may not be registered
        }
      }

      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Ping loop (fallback when PBS is unavailable) ─────────────────────────

  function startPingLoop() {
    stopPingLoop();
    pingTimerRef.current = setInterval(async () => {
      const reg = await getSwRegistration();
      if (reg?.active) {
        reg.active.postMessage({ type: 'WRAITH_SCAN_PING' });
      }
    }, PING_INTERVAL_MS);
  }

  function stopPingLoop() {
    if (pingTimerRef.current !== null) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }

  return { enabled, permissionState, pbsSupported, loading, error, enable, disable };
}

// ─── SW registration helpers ──────────────────────────────────────────────────

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(SW_PATH)) ?? null;
  } catch {
    return null;
  }
}

async function registerSw(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch {
    return null;
  }
}