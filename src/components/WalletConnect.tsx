import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ccc } from '@ckb-ccc/connector-react';
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
  const {
    address,
    isConnected,
    status,
    statusMessage,
    preferredNetwork,
    setPreferredNetwork,
    connect,
    disconnect,
    retryInstallDetection,
  } = useStellarWallet();

  const handleInstall = () => {
    window.open('https://www.freighter.app/', '_blank', 'noopener,noreferrer');
    retryInstallDetection();
  };

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <select
          value={preferredNetwork}
          onChange={(event) =>
            setPreferredNetwork(event.target.value as 'testnet' | 'futurenet' | 'mainnet')
          }
          className="h-8 border border-outline-variant bg-transparent px-2 font-mono text-[10px] uppercase tracking-widest text-primary sm:h-9"
          aria-label="Preferred Stellar network"
        >
          <option value="testnet">Testnet</option>
          <option value="futurenet">Futurenet</option>
          <option value="mainnet">Mainnet</option>
        </select>
        <button onClick={disconnect} className={btnConnected}>
          {address.slice(0, 4)}...{address.slice(-4)}
        </button>
      </div>
    );
  }

  if (status === 'not_installed') {
    return (
      <button onClick={handleInstall} title={statusMessage} className={btnBase}>
        Install Freighter
      </button>
    );
  }

  if (status === 'not_allowed') {
    return (
      <button onClick={connect} title={statusMessage} className={btnBase}>
        Approve Freighter
      </button>
    );
  }

  return (
    <button onClick={connect} title={statusMessage || undefined} className={btnBase}>
      {status === 'checking' ? 'Checking...' : 'Connect Freighter'}
    </button>
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
