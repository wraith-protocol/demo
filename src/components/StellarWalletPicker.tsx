/**
 * src/components/StellarWalletPicker.tsx
 *
 * Wallet selection modal shown when the user switches to the Stellar
 * chain and no wallet is connected.
 *
 * Displays all supported wallets with:
 *   - Icon + name
 *   - "Installed" badge (green) or "Not detected" + install link (muted)
 *   - Loading spinner while detection is running
 *   - Error message if connect fails
 *
 * Albedo and WalletConnect are always shown as available (web-based, no extension needed).
 * WalletConnect displays a QR code when selected.
 * LOBSTR uses deep-links when the extension is not detected.
 */

import { useState, useEffect } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { WALLET_IDS, WALLET_META, type WalletId } from '@/wallets/stellar';
import type { StellarWalletState } from '@/hooks/useStellarWallet';
import { PasskeyUnsupportedCard } from '@/components/PasskeyUnsupportedCard';

interface Props {
  state: StellarWalletState;
}

export function StellarWalletPicker({ state }: Props) {
  const {
    pickerOpen,
    closePicker,
    connect,
    status,
    error,
    errorCode,
    detecting,
    available,
    setPreconnectedWallet,
  } = state;

  const [pending, setPending] = useState<WalletId | null>(null);
  const [lastAttemptedId, setLastAttemptedId] = useState<WalletId | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcConnecting, setWcConnecting] = useState(false);

  // Poll for WalletConnect connection completion
  useEffect(() => {
    if (!wcUri || !wcConnecting) return;

    const pollInterval = setInterval(async () => {
      const adapter = (state as any).wcAdapter;
      if (adapter && typeof adapter.isConnectionReady === 'function') {
        // Check if connection is ready
        if (adapter.isConnectionReady()) {
          // Get the connection result
          const result = adapter.getConnectionResult();
          if (result && result.publicKey) {
            // Connection successful - use setPreconnectedWallet to update state
            setPreconnectedWallet(adapter, 'walletconnect', result.publicKey, result.network);
            setWcConnecting(false);
            setPending(null);
            setWcUri(null);
            // Clear the stored adapter
            delete (state as any).wcAdapter;
          }
        }
      }
    }, 1000);

    // Timeout after 5 minutes
    const timeout = setTimeout(
      () => {
        clearInterval(pollInterval);
        setWcConnecting(false);
        setPending(null);
      },
      5 * 60 * 1000,
    );

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [wcUri, wcConnecting, state, setPreconnectedWallet]);

  if (!pickerOpen) return null;

  async function handleSelect(id: WalletId) {
    if (pending) return;
    setPending(id);
    setLastAttemptedId(id);

    // Special handling for WalletConnect to capture URI
    if (id === 'walletconnect') {
      try {
        // Get a fresh adapter instance
        const { getAdapter } = await import('@/wallets/stellar');
        const adapter = getAdapter('walletconnect');

        // Start connection to get URI
        if (typeof (adapter as any).startConnection === 'function') {
          const uri = await (adapter as any).startConnection();
          if (uri) {
            setWcUri(uri);
            setWcConnecting(true);
            // Store the adapter for completion
            (state as any).wcAdapter = adapter;
          } else {
            setPending(null);
          }
        } else {
          // Fallback to regular connect
          await connect(id);
          setPending(null);
        }
      } catch (err) {
        console.error('WalletConnect start failed:', err);
        setPending(null);
      }
    } else {
      try {
        await connect(id);
      } finally {
        setPending(null);
      }
    }
  }

  function closeWcModal() {
    setWcUri(null);
    setWcConnecting(false);
    setPending(null);
    // Clear the stored adapter
    delete (state as any).wcAdapter;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Stellar wallet"
    >
      <div className="bg-[#141414] border border-[#2a2a2a] w-full max-w-sm p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#e6e1e5]">Connect Stellar wallet</h2>
          <button
            onClick={closePicker}
            className="text-[#555555] hover:text-[#c4c7c5] transition-colors"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        {/* Wallet list */}
        <div className="space-y-2">
          {WALLET_IDS.map((id) => {
            const meta = WALLET_META[id];
            // Albedo and WalletConnect are web-based — always available.
            // LOBSTR is always available via deep-links even without extension.
            const isAvail =
              available[id] ?? (id === 'albedo' || id === 'walletconnect' || id === 'lobstr');
            const isLoading = pending === id;
            const isDisabled = !!pending && pending !== id;

            return (
              <button
                key={id}
                data-testid={`wallet-option-${id}`}
                onClick={() => handleSelect(id)}
                disabled={isDisabled || isLoading}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2.5 border transition-colors',
                  isLoading
                    ? 'border-[#c6c6c7] bg-[#1e1e1e] opacity-100'
                    : isDisabled
                      ? 'border-[#1e1e1e] opacity-40 cursor-not-allowed'
                      : 'border-[#2a2a2a] hover:border-[#444444] hover:bg-[#1a1a1a] cursor-pointer',
                ].join(' ')}
              >
                {/* Icon */}
                <img
                  src={meta.icon}
                  alt=""
                  width={28}
                  height={28}
                  className="shrink-0 rounded-sm"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />

                {/* Name + status */}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm text-[#e6e1e5] font-medium">{meta.name}</p>
                  {detecting ? (
                    <p className="text-[11px] text-[#444444]">Detecting…</p>
                  ) : isAvail ? (
                    <p className="text-[11px] text-[#22c55e]">Installed</p>
                  ) : (
                    <a
                      href={meta.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#555555] hover:text-[#767575] transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Not detected — install ↗
                    </a>
                  )}
                </div>

                {/* Right side: spinner or connect cue */}
                <div className="shrink-0">
                  {isLoading ? (
                    <svg
                      className="animate-spin text-[#c6c6c7]"
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <circle
                        cx="7"
                        cy="7"
                        r="5.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="25"
                        strokeDashoffset="10"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="text-[#333333]"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <polyline points="4,2 8,6 4,10" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Error message */}
        {error &&
          status === 'error' &&
          (lastAttemptedId === 'passkey' && errorCode === 'NOT_AVAILABLE' ? (
            <PasskeyUnsupportedCard installUrl={WALLET_META.passkey.installUrl} />
          ) : (
            <p className="text-xs text-[#ee7d77] leading-relaxed">{error}</p>
          ))}

        {/* Footer note */}
        <p className="text-[10px] text-[#333333] leading-relaxed pt-1">
          Albedo, LOBSTR, and WalletConnect work in any browser — no extension needed. Freighter and
          xBull require their browser extension to be installed. Passkey needs no extension either —
          it signs with your device's built-in authenticator or a hardware security key.
        </p>
      </div>

      {/* WalletConnect QR Code Modal */}
      {wcUri && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-label="Scan WalletConnect QR code"
        >
          <div className="bg-[#141414] border border-[#2a2a2a] w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#e6e1e5]">Scan with WalletConnect</h2>
              <button
                onClick={closeWcModal}
                className="text-[#555555] hover:text-[#c4c7c5] transition-colors"
                aria-label="Close"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <line x1="1" y1="1" x2="13" y2="13" />
                  <line x1="13" y1="1" x2="1" y2="13" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col items-center space-y-4">
              <div className="bg-white p-4 rounded-lg">
                <QRCode value={wcUri} size={200} level="M" />
              </div>
              <p className="text-xs text-[#888888] text-center">
                Scan this QR code with your mobile wallet app
              </p>
              <a
                href={`wc:${wcUri}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#555555] hover:text-[#767575] transition-colors underline"
              >
                Or open in wallet app directly
              </a>
            </div>

            {status === 'connected' && (
              <div className="text-center">
                <p className="text-xs text-[#22c55e]">Wallet connected successfully!</p>
                <button
                  onClick={() => {
                    closeWcModal();
                    closePicker();
                  }}
                  className="mt-2 text-xs text-[#e6e1e5] hover:text-[#c4c7c5] transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
