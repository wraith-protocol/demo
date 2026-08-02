import { StellarLink } from '@/components/StellarLink';

export const walletBtnBase =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-50 sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';
export const walletBtnConnected =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-surface-bright sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';

export type FreighterStatus =
  | 'checking'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'mismatch'
  | 'not-installed';

interface FreighterConnectButtonProps {
  status: FreighterStatus;
  address?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function FreighterConnectButton({
  status,
  address,
  onConnect,
  onDisconnect,
}: FreighterConnectButtonProps) {
  if (status === 'checking') {
    return (
      <button disabled className={walletBtnBase}>
        ...
      </button>
    );
  }

  if (status === 'not-installed') {
    return (
      <a
        href="https://freighter.app"
        target="_blank"
        rel="noopener noreferrer"
        className={walletBtnBase}
      >
        Install Freighter
      </a>
    );
  }

  if (status === 'connected' && address) {
    return (
      <div className={`${walletBtnConnected} flex items-center gap-2`}>
        <StellarLink value={address} type="account" linkClassName="text-[10px] sm:text-xs">
          {address.slice(0, 4)}...{address.slice(-4)}
        </StellarLink>
        <button
          type="button"
          onClick={onDisconnect}
          className="text-outline transition-colors hover:text-error"
          aria-label="Disconnect Stellar wallet"
        >
          ×
        </button>
      </div>
    );
  }

  if (status === 'mismatch') {
    return (
      <button onClick={onConnect} className={`${walletBtnBase} border-error text-error`}>
        Wrong Network
      </button>
    );
  }

  return (
    <button onClick={onConnect} disabled={status === 'connecting'} className={walletBtnBase}>
      {status === 'connecting' ? 'Connecting...' : 'Connect Freighter'}
    </button>
  );
}
