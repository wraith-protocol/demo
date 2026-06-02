/**
 * src/components/StellarNotificationToggle.tsx
 *
 * Self-contained opt-in widget for the Receive page.
 *
 * States it handles:
 *   unsupported   — browser has no Notification API
 *   denied        — user or browser blocked permission; shows how to fix
 *   idle / off    — keys ready → shows toggle; keys not ready → shows hint
 *   confirming    — privacy disclosure modal before first enable
 *   loading       — spinner during permission request / SW registration
 *   enabled / on  — shows active status + PBS vs ping-loop note
 *   error         — shows the error inline below the toggle
 *
 * Props:
 *   viewingKeyHex     — derived Stellar viewing key (hex)
 *   spendingPubKeyHex — spending public key (hex)
 *   signingOutput     — raw bytes returned by wallet signMessage()
 *   lastSeenCursor    — optional Horizon cursor to avoid re-scanning history
 *   keysReady         — false while keys are being derived; disables toggle
 */

import { useState } from 'react';
import {
  useStellarNotifications,
  type EnableOpts,
} from '@/hooks/useStellarNotifications';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props extends Omit<EnableOpts, 'lastSeenCursor'> {
  lastSeenCursor?: string;
  keysReady:       boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StellarNotificationToggle(props: Props) {
  const {
    viewingKeyHex, spendingPubKeyHex, signingOutput,
    lastSeenCursor, keysReady,
  } = props;

  const {
    enabled, permissionState, pbsSupported,
    loading, error, enable, disable,
  } = useStellarNotifications();

  const [showDisclosure, setShowDisclosure] = useState(false);

  // ── Unsupported ─────────────────────────────────────────────────────────────
  if (permissionState === 'unsupported') {
    return (
      <p className="mt-4 text-xs text-[#555555]">
        Browser notifications are not supported in this environment.
      </p>
    );
  }

  // ── Permanently denied ──────────────────────────────────────────────────────
  if (permissionState === 'denied') {
    return (
      <div className="mt-4 border border-[#3a2020] bg-[#1a0e0e] p-3 flex items-start gap-2">
        <span className="text-[#ee7d77] font-mono text-sm leading-none mt-0.5" aria-hidden>!</span>
        <p className="text-xs text-[#c4a4a4] leading-relaxed">
          Notification permission is blocked. To enable: open your browser's site settings,
          allow notifications for this origin, then reload the page.
        </p>
      </div>
    );
  }

  // ── Toggle handlers ─────────────────────────────────────────────────────────
  function handleToggle() {
    if (enabled) {
      void disable();
      return;
    }
    if (!keysReady || loading) return;
    setShowDisclosure(true);
  }

  function handleConfirmEnable() {
    setShowDisclosure(false);
    void enable({ viewingKeyHex, spendingPubKeyHex, signingOutput, lastSeenCursor });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const toggleDisabled = loading || (!keysReady && !enabled);

  return (
    <div className="mt-4 border border-[#2a2a2a] p-3 space-y-2">

      {/* Row: label + toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-[#e6e1e5] font-medium leading-tight">
            Background payment notifications
          </p>
          <p className="text-xs text-[#555555] mt-0.5 leading-relaxed">
            Get notified when a Stellar payment arrives, even when this tab is closed.
            {' '}
            {!pbsSupported && (
              <span className="text-[#767575]">
                Best on Chrome / Edge / Firefox. iOS Safari support is limited.
              </span>
            )}
          </p>
        </div>

        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Background payment notifications"
          onClick={handleToggle}
          disabled={toggleDisabled}
          className={[
            'relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[#c6c6c7]',
            enabled            ? 'bg-[#22c55e]'            : 'bg-[#333333]',
            toggleDisabled     ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white',
              'shadow-sm transition-transform duration-200',
              enabled ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center">
              <svg
                className="animate-spin w-3 h-3 text-white opacity-70"
                viewBox="0 0 24 24" fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                  strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
              </svg>
            </span>
          )}
        </button>
      </div>

      {/* Keys not ready hint */}
      {!keysReady && !enabled && (
        <p className="text-xs text-[#555555]">
          Derive your keys above to enable notifications.
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-[#ee7d77] leading-relaxed">{error}</p>
      )}

      {/* Active — PBS mode */}
      {enabled && pbsSupported && (
        <p className="text-xs text-[#22c55e]">
          Active — background scans running (Chrome-controlled interval).
        </p>
      )}

      {/* Active — ping-loop fallback */}
      {enabled && !pbsSupported && (
        <p className="text-xs text-[#767575] leading-relaxed">
          Active — scanning every 5 minutes while this tab is open.
          For background scans, use Chrome or Edge.
        </p>
      )}

      {/* Privacy disclosure modal */}
      {showDisclosure && (
        <PrivacyDisclosure
          onConfirm={handleConfirmEnable}
          onCancel={() => setShowDisclosure(false)}
        />
      )}
    </div>
  );
}

// ─── Privacy disclosure modal ─────────────────────────────────────────────────

interface DisclosureProps {
  onConfirm: () => void;
  onCancel:  () => void;
}

function PrivacyDisclosure({ onConfirm, onCancel }: DisclosureProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-disclosure-title"
    >
      <div className="bg-[#111111] border border-[#2a2a2a] w-full max-w-md p-6 space-y-5">

        <h2 id="notif-disclosure-title" className="text-[#e6e1e5] font-semibold text-sm">
          Before enabling notifications
        </h2>

        <div className="space-y-3 text-xs text-[#888888] leading-relaxed">
          <p>
            To scan for payments while the tab is closed, Wraith must store an{' '}
            <strong className="text-[#c4c7c5]">encrypted copy of your viewing key</strong>{' '}
            in your browser's IndexedDB.
          </p>

          <ul className="space-y-1.5 list-none">
            {[
              'Encrypted with AES-256-GCM. The encryption key is derived from your wallet signature via PBKDF2 — it never leaves your device.',
              'The service worker decrypts the key in memory during each scan, then discards the plaintext immediately.',
              'Disabling notifications deletes the key from storage instantly.',
              'Your spending key is never stored. An attacker who reads your IndexedDB cannot move your funds.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-[#444444] shrink-0 mt-0.5">›</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-[#555555]">
            <strong className="text-[#767575]">Best supported on:</strong>{' '}
            Chrome 80+, Edge 80+, Firefox.
            iOS Safari 16.4+ has limited background sync — notifications may be delayed.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className={[
              'flex-1 bg-[#22c55e] text-[#0a0a0a] text-xs font-semibold py-2.5',
              'hover:bg-[#1daa52] transition-colors',
            ].join(' ')}
          >
            Enable notifications
          </button>
          <button
            onClick={onCancel}
            className={[
              'flex-1 border border-[#333333] text-[#888888] text-xs py-2.5',
              'hover:border-[#555555] hover:text-[#c4c7c5] transition-colors',
            ].join(' ')}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}