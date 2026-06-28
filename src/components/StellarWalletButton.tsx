/**
 * src/components/StellarWalletButton.tsx
 *
 * Compact wallet status button rendered in the Stellar chain header.
 *
 * States:
 *   - Disconnected → "Connect wallet" button → opens picker
 *   - Connecting   → spinner
 *   - Connected    → icon + truncated pubkey + disconnect option on click
 */

import { useState } from 'react';
import { WALLET_META } from '@/wallets/stellar';
import type { StellarWalletState } from '@/hooks/useStellarWallet';

interface Props {
  state: StellarWalletState;
}

function truncate(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function StellarWalletButton({ state }: Props) {
  const { status, walletId, publicKey, openPicker, disconnect } = state;
  const [showMenu, setShowMenu] = useState(false);

  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border border-[#2a2a2a] text-xs text-[#767575]">
        <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle
            cx="6"
            cy="6"
            r="4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="20"
            strokeDashoffset="8"
            strokeLinecap="round"
          />
        </svg>
        Connecting…
      </div>
    );
  }

  if (status === 'connected' && walletId && publicKey) {
    const meta = WALLET_META[walletId];
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu((v) => !v)}
          className={[
            'flex items-center gap-2 px-3 py-1.5 border text-xs transition-colors',
            'border-[#2a2a2a] text-[#e6e1e5] hover:border-[#444444]',
          ].join(' ')}
          aria-label="Wallet menu"
          data-testid="wallet-connected-button"
        >
          <img src={meta.icon} alt={meta.name} width={14} height={14} className="rounded-sm" />
          <span className="font-mono">{truncate(publicKey)}</span>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <polyline points="1,2 4,5 7,2" />
          </svg>
        </button>

        {showMenu && (
          <div className="absolute right-0 top-full mt-1 z-20 bg-[#141414] border border-[#2a2a2a] w-44">
            <div className="px-3 py-2 border-b border-[#1e1e1e]">
              <p className="text-[10px] text-[#555555] uppercase tracking-wide">Connected via</p>
              <p className="text-xs text-[#c4c7c5] mt-0.5">{meta.name}</p>
            </div>
            <button
              onClick={async () => {
                setShowMenu(false);
                await disconnect();
              }}
              className="w-full text-left px-3 py-2 text-xs text-[#ee7d77] hover:bg-[#1a1a1a] transition-colors"
              data-testid="wallet-disconnect-button"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={openPicker}
      className={[
        'px-3 py-1.5 border border-[#2a2a2a] text-xs text-[#c4c7c5]',
        'hover:border-[#444444] hover:text-[#e6e1e5] transition-colors',
      ].join(' ')}
      data-testid="wallet-connect-button"
    >
      Connect wallet
    </button>
  );
}
