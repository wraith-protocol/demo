import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { TelemetryBanner } from '@/components/TelemetryBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { RouteFallback } from '@/components/RouteFallback';
import { RouteErrorBoundary, LazyPage } from '@/components/RouteErrorBoundary';
import { HelpButton } from '@/components/HelpButton';
import { useNotificationSW } from '@/hooks/useNotificationSW';
import { useOfflineReconcile } from '@/hooks/useOfflineReconcile';
import { useChain } from '@/context/ChainContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { KeyVault } from '@/vault/KeyVault';
import {
  APP_IDLE_TIMEOUT_MS,
  IdleLock,
  authenticateWithPasskey,
  isPasskeySupported,
} from '@/lib/idleLock';
import { parseStellarQrPayload } from '@/utils/qr';
import { useOfflineQueueStore } from '@/stores/offlineQueueStore';
import { initNameWatchlistSync, cleanupNameWatchlistSync } from '@/store/nameWatchlistStore';

// Code-split per route so the initial bundle only ships the app shell.
// Each page (and the chain-specific wallet SDKs it pulls in — see
// pages/Send.tsx and pages/Receive.tsx) loads on first navigation instead
// of up front. RouteErrorBoundary + RouteFallback below handle the load.
// Loaders stay as plain module-level functions (not lazy() itself) so
// LazyPage can construct a fresh lazy component on retry; see
// RouteErrorBoundary.tsx for why that distinction matters.
const loadSend = () => import('@/pages/Send');
const loadReceive = () => import('@/pages/Receive');
const loadPrivacy = () => import('@/pages/Privacy');
const loadVault = () => import('@/pages/Vault');
const loadNotifications = () => import('@/pages/Notifications');
const loadSchedule = () => import('@/pages/Schedule');
const loadStellarSplit = () => import('@/pages/StellarSplit');
const loadNames = () => import('@/pages/Names');
const loadNameProfile = () => import('@/pages/NameProfile');
const loadNamesAuctions = () => import('@/pages/NamesAuctions');
const loadActivity = () => import('@/pages/Activity');
const loadPortfolio = () => import('@/pages/Portfolio');
const loadDebug = () => import('@/pages/Debug');

function SessionLock({ onUnlock }: { onUnlock: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vaultRef = useRef<KeyVault | null>(null);

  const unlockWithPasskey = async () => {
    setBusy(true);
    setError('');
    try {
      await authenticateWithPasskey();
      onUnlock();
    } catch {
      setError('No Wraith passkey was found. Unlock with your vault passphrase instead.');
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPassphrase = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase) return;

    setBusy(true);
    setError('');
    try {
      vaultRef.current ??= new KeyVault({
        idleTimeoutMs: 0,
        lockOnBlur: false,
        lockOnVisibilityChange: false,
      });
      await vaultRef.current.unlock(passphrase);
      await vaultRef.current.lock();
      setPassphrase('');
      onUnlock();
    } catch {
      setError('That passphrase could not unlock the Wraith vault.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-sm border border-outline-variant bg-surface-container p-6">
        <img src="/logo.png" alt="" className="mb-5 h-8 w-8" />
        <h1 className="font-heading text-lg font-bold uppercase tracking-widest text-on-surface">
          Wraith locked
        </h1>
        <p className="mt-2 font-body text-sm leading-relaxed text-on-surface-variant">
          Your session was locked after five minutes of inactivity.
        </p>

        {isPasskeySupported() && (
          <button
            type="button"
            onClick={unlockWithPasskey}
            disabled={busy}
            className="mt-6 h-11 w-full bg-primary font-heading text-[11px] font-semibold uppercase tracking-widest text-surface disabled:opacity-50"
          >
            Unlock with passkey
          </button>
        )}

        <form onSubmit={unlockWithPassphrase} className="mt-4">
          <label
            htmlFor="session-passphrase"
            className="font-heading text-[10px] uppercase tracking-widest text-outline"
          >
            Vault passphrase
          </label>
          <input
            id="session-passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="mt-2 h-11 w-full border border-outline-variant bg-surface px-3 font-body text-sm text-on-surface outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !passphrase}
            className="mt-3 h-11 w-full border border-primary font-heading text-[11px] font-semibold uppercase tracking-widest text-primary disabled:opacity-50"
          >
            {busy ? 'Unlocking...' : 'Unlock with passphrase'}
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-4 font-body text-xs text-error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

export function App() {
  useNotificationSW();
  // Wave 9 (#184): reconcile the explicit offline queue on reconnect.
  useOfflineReconcile();
  const location = useLocation();
  const navigate = useNavigate();
  const { setChain } = useChain();
  const { clearEvm, clearStellar, clearSolana, clearCkb } = useStealthKeys();
  const [sessionLocked, setSessionLocked] = useState(false);

  const relockSession = useCallback(() => {
    clearEvm();
    clearStellar();
    clearSolana();
    clearCkb();
    setSessionLocked(true);
  }, [clearCkb, clearEvm, clearSolana, clearStellar]);

  useEffect(() => {
    if (sessionLocked) return;
    const idleLock = new IdleLock({ timeoutMs: APP_IDLE_TIMEOUT_MS, onIdle: relockSession });
    idleLock.start();
    return () => idleLock.stop();
  }, [relockSession, sessionLocked]);

  useEffect(() => {
    initNameWatchlistSync();
    return () => cleanupNameWatchlistSync();
  }, []);

  useEffect(() => {
    if (location.pathname !== '/send') return;
    const sharedText = new URLSearchParams(location.search).get('text');
    if (!sharedText) return;

    // Wave 9 (#184): persist shared-text scans captured while offline so the
    // intent survives reloads; reconciliation revalidates it on reconnect.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const offlinePayload = parseStellarQrPayload(sharedText);
        useOfflineQueueStore.getState().enqueueScanSession({
          source: 'shared-text',
          rawText: sharedText,
          parsed: {
            metaAddress: offlinePayload.metaAddress,
            ...(offlinePayload.amount ? { amount: offlinePayload.amount } : {}),
            ...(offlinePayload.memo ? { memo: offlinePayload.memo } : {}),
          },
          capturedAt: Date.now(),
        });
      } catch {
        // Unparseable text is still applied below for manual correction.
      }
    }

    try {
      const payload = parseStellarQrPayload(sharedText);
      const params = new URLSearchParams({ to: payload.metaAddress });
      if (payload.amount) params.set('amount', payload.amount);
      if (payload.memo) params.set('memo', payload.memo);
      setChain('stellar');
      navigate(`/send?${params.toString()}`, { replace: true });
    } catch {
      // Leave unsupported shared text untouched so the user can correct it manually.
    }
  }, [location.pathname, location.search, navigate, setChain]);

  if (sessionLocked) return <SessionLock onUnlock={() => setSessionLocked(false)} />;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <UpdatePrompt />
      <OfflineBanner />
      <TelemetryBanner />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/send" element={<LazyPage loader={loadSend} />} />
              <Route path="/receive" element={<LazyPage loader={loadReceive} />} />
              <Route path="/privacy" element={<LazyPage loader={loadPrivacy} />} />
              <Route path="/vault" element={<LazyPage loader={loadVault} />} />
              <Route path="/notifications" element={<LazyPage loader={loadNotifications} />} />
              <Route path="/schedule" element={<LazyPage loader={loadSchedule} />} />
              <Route path="/stellar/split" element={<LazyPage loader={loadStellarSplit} />} />
              <Route path="/pay" element={<LazyPage loader={loadSend} />} />
              <Route path="/names" element={<LazyPage loader={loadNames} />} />
              <Route path="/n/:name" element={<LazyPage loader={loadNameProfile} />} />
              <Route path="/names/auctions" element={<LazyPage loader={loadNamesAuctions} />} />
              <Route path="/activity" element={<LazyPage loader={loadActivity} />} />
              <Route path="/history" element={<LazyPage loader={loadActivity} />} />
              <Route path="/portfolio" element={<LazyPage loader={loadPortfolio} />} />
              <Route path="/debug" element={<LazyPage loader={loadDebug} />} />
              <Route path="*" element={<Navigate to="/send" replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </main>
      <HelpButton />
    </div>
  );
}
