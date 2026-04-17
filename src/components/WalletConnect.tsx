import { useState, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useChain } from '@/context/ChainContext';
import { useStellarWallet } from '@/context/StellarWalletContext';

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
  const { address, isConnected, connect, disconnect } = useStellarWallet();

  if (isConnected && address) {
    return (
      <button onClick={disconnect} className={btnConnected}>
        {address.slice(0, 4)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button onClick={connect} className={btnBase}>
      Connect Wallet
    </button>
  );
}

function PhantomButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState('');

  const connect = useCallback(async () => {
    try {
      const phantom = (window as unknown as Record<string, unknown>).solana as
        | {
            isPhantom?: boolean;
            connect: () => Promise<{ publicKey: { toString: () => string } }>;
          }
        | undefined;
      if (!phantom?.isPhantom) {
        setError('Phantom not found');
        return;
      }
      const resp = await phantom.connect();
      setAddress(resp.publicKey.toString());
    } catch {
      setError('Connect failed');
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
    <>
      <button onClick={connect} className={btnBase}>
        Connect Phantom
      </button>
      {error && <span className="text-[10px] text-error">{error}</span>}
    </>
  );
}

function CkbPlaceholder() {
  return (
    <span className="px-3 py-1.5 font-heading text-[10px] uppercase tracking-widest text-outline sm:px-4 sm:py-2 sm:text-xs">
      Manual Key Input
    </span>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  if (chain === 'stellar') return <FreighterButton />;
  if (chain === 'solana') return <PhantomButton />;
  if (chain === 'ckb') return <CkbPlaceholder />;
  return <HorizenButton />;
}
