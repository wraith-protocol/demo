import { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useChain } from '@/context/ChainContext';

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
      <button
        onClick={disconnect}
        className="border border-outline-variant px-4 py-2 font-mono text-xs text-primary transition-colors hover:bg-surface-bright"
      >
        {address.slice(0, 4)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="border border-outline-variant px-4 py-2 font-heading text-xs uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-50"
    >
      {loading ? '...' : 'Connect Wallet'}
    </button>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return <FreighterButton />;
  }

  return <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />;
}
