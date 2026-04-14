import { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useChain } from '@/context/ChainContext';

const btnBase =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-50 sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';
const btnConnected =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-surface-bright sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';

function HorizenButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            {...(!mounted && {
              'aria-hidden': true,
              style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
            })}
          >
            {!connected ? (
              <button onClick={openConnectModal} className={btnBase}>
                Connect Wallet
              </button>
            ) : (
              <button onClick={openAccountModal} className={btnConnected}>
                {account.displayName}
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

function FreighterButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const freighter = await import('@stellar/freighter-api');
        const { isConnected } = await freighter.isConnected();
        if (isConnected) {
          const { address: addr } = await freighter.getAddress();
          if (addr) setAddress(addr);
        }
      } catch {
        // Freighter not available
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    try {
      const freighter = await import('@stellar/freighter-api');
      const { isConnected } = await freighter.isConnected();
      if (!isConnected) {
        throw new Error('Freighter not found. Install the browser extension.');
      }
      await freighter.requestAccess();
      const { address: addr } = await freighter.getAddress();
      if (addr) setAddress(addr);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  if (address) {
    return (
      <button onClick={disconnect} className={btnConnected}>
        {address.slice(0, 4)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button onClick={connect} disabled={loading} className={btnBase}>
      {loading ? '...' : 'Connect Wallet'}
    </button>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return <FreighterButton />;
  }

  return <HorizenButton />;
}
