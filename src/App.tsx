import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { TelemetryBanner } from '@/components/TelemetryBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';
import Privacy from '@/pages/Privacy';
import Settings from '@/pages/Settings';
import { HelpButton } from '@/components/HelpButton';
import Vault from '@/pages/Vault';
import Notifications from '@/pages/Notifications';
import { useNotificationSW } from '@/hooks/useNotificationSW';
import Schedule from '@/pages/Schedule';
import StellarSplit from '@/pages/StellarSplit';
import Names from '@/pages/Names';
import NameProfile from '@/pages/NameProfile';
import NamesAuctions from '@/pages/NamesAuctions';
import Activity from '@/pages/Activity';
import Portfolio from '@/pages/Portfolio';
import Debug from '@/pages/Debug';
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
    if (location.pathname !== '/send') return;
    const sharedText = new URLSearchParams(location.search).get('text');
    if (!sharedText) return;

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
      <OfflineBanner />
      <TelemetryBanner />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/stellar/split" element={<StellarSplit />} />
          <Route path="/pay" element={<Send />} />
          <Route path="/names" element={<Names />} />
          <Route path="/n/:name" element={<NameProfile />} />
          <Route path="/names/auctions" element={<NamesAuctions />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/history" element={<Activity />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/debug" element={<Debug />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
      <HelpButton />
    </div>
  );
}
