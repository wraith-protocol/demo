/**
 * StellarNotificationToggle.tsx
 *
 * A self-contained opt-in widget for the Receive page. Shows:
 *   • A toggle to enable/disable background payment notifications.
 *   • A privacy disclosure (viewing key storage) shown before first opt-in.
 *   • Browser compatibility note (best on Chrome/Edge/Firefox; limited on iOS).
 *   • Graceful handling of "permission denied" state.
 *
 * Props:
 *   viewingKeyHex       — The user's derived Stellar viewing key (hex)
 *   spendingPubKeyHex   — The user's spending public key (hex)
 *   signingOutput       — Raw hex returned by signMessage() (used for KDF)
 *   lastSeenCursor      — Optional Horizon cursor so we don't re-scan old txs
 *   keysReady           — Pass false to disable the toggle until keys are derived
 */

import { useState } from 'react';
import { useStellarNotifications } from '@/hooks/useStellarNotifications';

interface Props {
  viewingKeyHex: string;
  spendingPubKeyHex: string;
  signingOutput: string;
  lastSeenCursor?: string;
  keysReady: boolean;
}

export function StellarNotificationToggle({
  viewingKeyHex,
  spendingPubKeyHex,
  signingOutput,
  lastSeenCursor,
  keysReady,
}: Props) {
  const { enabled, permissionState, pbsSupported, loading, error, enable, disable } =
    useStellarNotifications();

  const [showDisclosure, setShowDisclosure] = useState(false);

  // ── Unsupported browser ──────────────────────────────────────────────────
  if (permissionState === 'unsupported') {
    return (
      <div className="text-xs text-[#767575] mt-4">
        Browser notifications are not supported in this environment.
      </div>
    );
  }

  // ── Permission permanently denied ────────────────────────────────────────
  if (permissionState === 'denied') {
    return (
      <div className="mt-4 border border-[#444444] p-3">
        <div className="flex items-start gap-2">
          <span className="text-[#ee7d77] text-sm font-mono leading-tight">!</span>
          <p className="text-xs text-[#c4c7c5] leading-relaxed">
            Notification permission is blocked. To enable, open your browser&apos;s site
            settings and allow notifications for this origin, then reload.
          </p>
        </div>
      </div>
    );
  }

  // ── Main toggle ──────────────────────────────────────────────────────────
  const handleToggle = async () => {
    if (enabled) {
      await disable();
      return;
    }
    if (!keysReady) return;
    // Show disclosure first if not yet enabled
    setShowDisclosure(true);
  };

  const handleConfirmEnable = async () => {
    setShowDisclosure(false);
    await enable({ viewingKeyHex, spendingPubKeyHex, signingOutput, lastSeenCursor });
  };

  return (
    <div className="mt-4 border border-[#444444] p-3 space-y-2">
      {/* Row: label + toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-[#e6e1e5] font-medium leading-tight">
            Background payment notifications
          </p>
          <p className="text-xs text-[#767575] mt-0.5 leading-relaxed">
            Get notified when a Stellar payment arrives, even when this tab is closed.{' '}
            {!pbsSupported && (
              <span className="text-[#c4c7c5]">
                Best on Chrome / Edge / Firefox. iOS Safari support is limited.
              </span>
            )}
          </p>
        </div>

        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={loading || (!keysReady && !enabled)}
          className={[
            'relative shrink-0 w-10 h-5 transition-colors duration-200',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c6c6c7]',
            enabled ? 'bg-[#22c55e]' : 'bg-[#444444]',
            loading || (!keysReady && !enabled) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 left-0.5 w-4 h-4 bg-[#0e0e0e] transition-transform duration-200',
              enabled ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </button>
      </div>

      {/* Keys not yet derived hint */}
      {!keysReady && !enabled && (
        <p className="text-xs text-[#767575]">Derive your keys above to enable notifications.</p>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-[#ee7d77]">{error}</p>
      )}

      {/* PBS not available note */}
      {enabled && !pbsSupported && (
        <p className="text-xs text-[#767575]">
          Periodic Background Sync is unavailable in this browser. Notifications will fire
          while this tab remains open (every 5 minutes). Keep the tab running in the
          background for continuous monitoring.
        </p>
      )}

      {/* Active status */}
      {enabled && pbsSupported && (
        <p className="text-xs text-[#22c55e]">
          Active — background scans running every ~5 min (Chrome-controlled).
        </p>
      )}

      {/* ── Privacy disclosure modal ── */}
      {showDisclosure && (
        <PrivacyDisclosure
          onConfirm={handleConfirmEnable}
          onCancel={() => setShowDisclosure(false)}
        />
      )}
    </div>
  );
}

// ─── Privacy disclosure ───────────────────────────────────────────────────────

function PrivacyDisclosure({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label="Notification privacy disclosure"
    >
      <div className="bg-[#141414] border border-[#444444] w-full max-w-md p-6 space-y-4">
        <h2 className="text-[#e6e1e5] font-semibold text-base">
          Before enabling notifications
        </h2>

        <div className="space-y-3 text-sm text-[#c4c7c5] leading-relaxed">
          <p>
            To scan for payments in the background, Wraith needs to store an
            <strong className="text-[#e6e1e5]"> encrypted copy of your viewing key</strong> in
            your browser&apos;s IndexedDB.
          </p>

          <ul className="list-disc list-inside space-y-1 text-xs text-[#c4c7c5]">
            <li>
              The key is encrypted with AES-256-GCM, derived via PBKDF2 from your wallet
              signature. It never leaves your device.
            </li>
            <li>
              The service worker reads it in memory only during a scan, then discards the
              plaintext.
            </li>
            <li>
              Disabling notifications immediately deletes the key from storage.
            </li>
          </ul>

          <p className="text-xs text-[#767575]">
            The <strong className="text-[#c4c7c5]">spending key</strong> is never stored.
            An attacker with access to your browser cannot spend your funds, only detect
            that a payment arrived.
          </p>

          <p className="text-xs text-[#767575]">
            <strong className="text-[#c4c7c5]">Best supported on:</strong> Chrome 80+,
            Edge 80+, Firefox. iOS Safari 16.4+ has limited background sync support
            (notifications may be delayed or infrequent).
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onConfirm}
            className="flex-1 bg-[#22c55e] text-[#0e0e0e] text-sm font-semibold py-2 hover:brightness-110 transition-[filter]"
          >
            Enable notifications
          </button>
          <button
            onClick={onCancel}
            className="flex-1 border border-[#444444] text-[#c4c7c5] text-sm py-2 hover:border-[#767575] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}