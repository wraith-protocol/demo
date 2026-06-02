/**
 * src/hooks/useStellarNotifications.ts
 *
 * React hook that owns the full opt-in lifecycle for browser push
 * notifications on Stellar stealth payments.
 *
 * Flow when the user enables:
 *   1. Request Notification.permission
 *   2. Register /stellar-notification-sw.js as a ServiceWorker
 *   3. Register Periodic Background Sync tag 'wraith-stellar-scan' (best-effort)
 *   4. Encrypt the viewing key with AES-GCM and persist to IndexedDB
 *   5. Post WRAITH_SCAN_NOW for an immediate first scan
 *   6. Start the 5-minute ping loop (fallback when PBS is unavailable)
 *
 * Flow when the user disables:
 *   1. Stop the ping loop
 *   2. clearState() — removes encrypted key from IndexedDB immediately
 *   3. Unregister the PBS tag (best-effort)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearState,
  encryptViewingKey,
  readState,
  writeState,
} from '@/lib/notification-storage';

const SYNC_TAG        = 'wraith-stellar-scan';
const SW_PATH         = '/stellar-notification-sw.js';
const PING_INTERVAL   = 5 * 60 * 1000; // ms

export type PermissionStatus = 'default' | 'granted' | 'denied' | 'unsupported';

export interface StellarNotificationHook {
  enabled:         boolean;
  permissionState: PermissionStatus;
  /** True when Periodic Background Sync is available (Chrome / Edge). */
  pbsSupported:    boolean;
  /** True while the permission prompt or SW registration is in progress. */
  loading:         boolean;
  error:           string | null;
  enable: (opts: EnableOpts) => Promise<void>;
  disable: ()       => Promise<void>;
}

export interface EnableOpts {
  /** Derived Stellar viewing key (hex). */
  viewingKeyHex:     string;
  /** Spending public key hex — passed to SDK scan. */
  spendingPubKeyHex: string;
  /** Raw bytes returned by the wallet's signMessage(). Used as PBKDF2 input. */
  signingOutput:     string;
  /** Horizon paging_token to start scanning from (avoids re-scanning history). */
  lastSeenCursor?:   string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStellarNotifications(): StellarNotificationHook {
  const [enabled,         setEnabled]         = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionStatus>('default');
  const [pbsSupported,    setPbsSupported]    = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Bootstrap: restore persisted state on mount ─────────────────────────────
  useEffect(() => {
    let active = true;

    async function init() {
      if (!('Notification' in window)) {
        setPermissionState('unsupported');
        return;
      }
      setPermissionState(Notification.permission as PermissionStatus);

      const reg = await getRegistration();
      if (reg && 'periodicSync' in reg) setPbsSupported(true);

      const state = await readState();
      if (!active) return;

      if (state?.enabled && Notification.permission === 'granted') {
        setEnabled(true);
        startPing();
      }
    }

    init().catch(console.error);
    return () => {
      active = false;
      stopPing();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Enable ──────────────────────────────────────────────────────────────────
  const enable = useCallback(async (opts: EnableOpts) => {
    setLoading(true);
    setError(null);

    try {
      if (!('Notification' in window)) {
        throw new Error('Notifications are not supported in this browser.');
      }

      // 1. Permission
      const perm = await Notification.requestPermission();
      setPermissionState(perm as PermissionStatus);
      if (perm !== 'granted') {
        throw new Error(
          'Notification permission was not granted. ' +
          'You can change this in your browser site settings.',
        );
      }

      // 2. Service worker
      const reg = await registerSw();
      if (!reg) throw new Error('Service worker registration failed.');

      // 3. Periodic Background Sync (best-effort — fails silently on Firefox / iOS)
      if ('periodicSync' in reg) {
        try {
          await (reg as any).periodicSync.register(SYNC_TAG, {
            minInterval: PING_INTERVAL,
          });
        } catch {
          // PBS permission denied or not supported — ping loop handles fallback
        }
      }

      // 4. Encrypt viewing key and persist
      const encryptedViewingKey = await encryptViewingKey(
        opts.viewingKeyHex,
        opts.signingOutput,
      );

      await writeState({
        enabled:           true,
        chain:             'stellar',
        encryptedViewingKey,
        signingOutput:     opts.signingOutput,
        spendingPubKeyHex: opts.spendingPubKeyHex,
        lastSeenCursor:    opts.lastSeenCursor,
      });

      // 5. Immediate first scan
      if (reg.active) {
        reg.active.postMessage({ type: 'WRAITH_SCAN_NOW' });
      } else {
        // SW not yet activated — wait for it
        navigator.serviceWorker.ready.then((r) => {
          r.active?.postMessage({ type: 'WRAITH_SCAN_NOW' });
        });
      }

      setEnabled(true);
      startPing();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Disable ─────────────────────────────────────────────────────────────────
  const disable = useCallback(async () => {
    setLoading(true);
    try {
      stopPing();
      // Remove encrypted key first — if anything below fails the key is gone.
      await clearState();

      const reg = await getRegistration();
      if (reg && 'periodicSync' in reg) {
        try {
          await (reg as any).periodicSync.unregister(SYNC_TAG);
        } catch {
          // Not registered or already removed — ignore.
        }
      }

      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Ping loop (fallback for Firefox / iOS Safari) ───────────────────────────
  function startPing() {
    stopPing();
    pingRef.current = setInterval(async () => {
      const reg = await getRegistration();
      reg?.active?.postMessage({ type: 'WRAITH_SCAN_PING' });
    }, PING_INTERVAL);
  }

  function stopPing() {
    if (pingRef.current !== null) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  }

  return { enabled, permissionState, pbsSupported, loading, error, enable, disable };
}

// ─── SW helpers ───────────────────────────────────────────────────────────────

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
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
    return await navigator.serviceWorker.register(SW_PATH, {
      scope:        '/',
      updateViaCache: 'none',   // always check for a new SW on page load
    });
  } catch {
    return null;
  }
}