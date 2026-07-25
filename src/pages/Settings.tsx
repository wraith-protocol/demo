import { useEffect, useMemo, useState } from 'react';
import { trackPageView } from '@/lib/telemetry';
import {
  getPasskeyState,
  isPasskeySupported,
  registerPasskey,
  setPasskeyEnabled,
  shouldUsePasskey,
} from '@/lib/stellar/passkey';

export default function Settings() {
  useEffect(() => {
    trackPageView('/settings');
  }, []);

  const [state, setState] = useState(() => getPasskeyState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const supported = useMemo(() => isPasskeySupported(), []);

  async function handleRegister() {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const next = await registerPasskey({ userName: 'wraith-demo' });
      setState(next);
      setMessage('Passkey registered. Future Stellar signing will use it when available.');
    } catch (err) {
      const nextError = err instanceof Error ? err.message : 'Passkey registration failed.';
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(nextEnabled: boolean) {
    const next = setPasskeyEnabled(nextEnabled);
    setState(next);
    setMessage(nextEnabled ? 'Passkey signing is enabled.' : 'Passkey signing is disabled.');
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-on-surface">Settings</h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Opt in to passkey-based Stellar signing for stealth operations. Passkeys keep the signing
          step in the browser and avoid extension prompts when the authenticator is available.
        </p>
      </div>

      <section className="border border-outline-variant bg-surface-container p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-medium text-on-surface">Sign with Passkey</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Use a browser passkey for signing instead of prompting Freighter for every action.
            </p>
          </div>
          <button
            onClick={() => handleToggle(!state.enabled)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              state.enabled ? 'bg-primary' : 'bg-outline-variant'
            }`}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full bg-surface transition-transform ${
                state.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm text-on-surface-variant">
          <p>
            Status:{' '}
            <span className="font-mono text-primary">
              {supported
                ? state.registered
                  ? 'registered and ready'
                  : 'supported but not registered'
                : 'not supported in this browser'}
            </span>
          </p>
          <p>
            Passkeys cover the signing step in your browser. They do not custody funds, replace the
            Stellar account, or bypass the final transaction review in Freighter when fallback is
            used.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleRegister}
            disabled={busy || !supported}
            className="h-11 border border-outline-variant px-4 font-heading text-[12px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
          >
            {busy
              ? 'Registering...'
              : state.registered
                ? 'Re-register Passkey'
                : 'Register Passkey'}
          </button>
          <div className="rounded border border-outline-variant bg-surface p-3 text-xs leading-relaxed text-on-surface-variant">
            On Chrome or Safari, registration uses the browser authenticator. If it fails or no
            passkey is present, the app falls back to Freighter.
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-error">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-tertiary">{message}</p> : null}
      </section>

      <section className="border border-outline-variant bg-surface-container p-5">
        <h2 className="font-heading text-lg font-medium text-on-surface">What this covers</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-on-surface-variant">
          <li>
            • Lets the browser sign stealth-authentication messages without an extension prompt.
          </li>
          <li>• Keeps the signing operation local to the authenticator and your browser.</li>
          <li>• Does not replace your Stellar wallet or change who controls the funds.</li>
        </ul>
      </section>
    </div>
  );
}
