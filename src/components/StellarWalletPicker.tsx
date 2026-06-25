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
 * Albedo is always shown as available (web-based, no extension needed).
 */

import { useState } from 'react';
import { WALLET_IDS, WALLET_META, type WalletId } from '@/wallets/stellar';
import type { StellarWalletState } from '@/hooks/useStellarWallet';

interface Props {
  state: StellarWalletState;
}

export function StellarWalletPicker({ state }: Props) {
  const { pickerOpen, closePicker, connect, status, error, detecting, available } = state;

  const [pending, setPending] = useState<WalletId | null>(null);

  if (!pickerOpen) return null;

  async function handleSelect(id: WalletId) {
    if (pending) return;
    setPending(id);
    try {
      await connect(id);
    } finally {
      setPending(null);
    }
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Wallet list */}
        <div className="space-y-2">
          {WALLET_IDS.map((id) => {
            const meta      = WALLET_META[id];
            const isAvail   = available[id] ?? (id === 'albedo'); // albedo always available
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
                      width="14" height="14" viewBox="0 0 14 14" fill="none"
                    >
                      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"
                        strokeDasharray="25" strokeDashoffset="10" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg
                      className="text-[#333333]"
                      width="12" height="12" viewBox="0 0 12 12" fill="none"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    >
                      <polyline points="4,2 8,6 4,10"/>
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Error message */}
        {error && status === 'error' && (
          <p className="text-xs text-[#ee7d77] leading-relaxed">{error}</p>
        )}

        {/* Footer note */}
        <p className="text-[10px] text-[#333333] leading-relaxed pt-1">
          Albedo works in any browser — no extension needed. Other wallets require
          their browser extension to be installed.
        </p>
      </div>
    </div>
  );
}