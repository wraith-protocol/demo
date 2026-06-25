import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ccc } from '@ckb-ccc/connector-react';
import { useChain } from '@/context/ChainContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  FreighterConnectButton,
  walletBtnBase as btnBase,
  walletBtnConnected as btnConnected,
  type FreighterStatus,
} from '@/components/FreighterConnectButton';

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
  const { address, isConnected, isInstalled, isNetworkMismatch, connect, disconnect } =
    useStellarWallet();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  };

  const status: FreighterStatus =
    isInstalled === null
      ? 'checking'
      : !isInstalled
        ? 'not-installed'
        : isNetworkMismatch
          ? 'mismatch'
          : isConnected && address
            ? 'connected'
            : isConnecting
              ? 'connecting'
              : 'disconnected';

  return (
    <FreighterConnectButton
      status={status}
      address={address}
      onConnect={handleConnect}
      onDisconnect={disconnect}
    />
  );
}

function SolanaButton() {
  const { publicKey, connected, disconnect } = useWallet();

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    return (
      <button onClick={disconnect} className={btnConnected}>
        {addr.slice(0, 4)}...{addr.slice(-4)}
      </button>
    );
  }

  return <WalletMultiButton className={btnBase} />;
}

function CkbButton() {
  const { open, wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [address, setAddress] = useState<string>('');

  useEffect(() => {
    if (!signer) return;
    (async () => {
      const addr = await signer.getRecommendedAddress();
      setAddress(addr);
    })();
  }, [signer]);

  if (wallet && address) {
    return (
      <button onClick={open} className={btnConnected}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button onClick={open} className={btnBase}>
      Connect Wallet
    </button>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  if (chain === 'stellar') return <FreighterButton />;
  if (chain === 'solana') return <SolanaButton />;
  if (chain === 'ckb') return <CkbButton />;
  return <HorizenButton />;
}
