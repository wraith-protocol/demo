import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ccc } from '@ckb-ccc/connector-react';
import { useTranslation } from 'react-i18next';
import { useChain } from '@/context/ChainContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { trackEvent } from '@/lib/telemetry';

const btnBase =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-50 sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';
const btnConnected =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-surface-bright sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';
import { useStellarWallet as useStellarWalletContext } from '@/context/StellarWalletContext';
import { useStellarWallet as useStellarWalletHook } from '@/hooks/useStellarWallet';
import { StellarWalletPicker } from '@/components/StellarWalletPicker';
import {
  walletBtnBase as btnBase,
  walletBtnConnected as btnConnected,
  type FreighterStatus,
} from '@/components/FreighterConnectButton';

function HorizenButton() {
  const { t } = useTranslation();
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
                {t('walletConnect.connectWallet')}
              <button onClick={() => { openConnectModal(); trackEvent('connect_wallet'); }} className={btnBase}>
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

function StellarButton() {
  const stellarWallet = useStellarWalletHook();
  const { address, isConnected, connect } = useStellarWalletContext();
function FreighterButton() {
  const { t } = useTranslation();
  const { address, isConnected, connect, disconnect } = useStellarWallet();
  const { address, isConnected, connect, disconnect } = useStellarWallet();
  const [error, setError] = useState<string | null>(null);
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
    <button onClick={connect} className={btnBase}>
      {t('walletConnect.connectFreighter')}
    </button>
    <FreighterConnectButton
      status={status}
      address={address}
      onConnect={handleConnect}
      onDisconnect={disconnect}
    />
    <>
    <button onClick={() => { connect(); trackEvent('connect_wallet'); }} className={btnBase}>
      Connect Freighter
    </button>
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={async () => {
          setError(null);
          try {
            await connect();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Connection failed');
          }
        }}
        className={btnBase}
      >
        Connect Freighter
      </button>
      {error && <span className="text-[10px] text-error font-mono">{error}</span>}
    </div>
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
return <WalletMultiButton className={btnBase} onClick={() => trackEvent('connect_wallet')} />;
  
}

function CkbButton() {
  const { t } = useTranslation();
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
      {t('walletConnect.connectWallet')}
    <button onClick={() => { open(); trackEvent('connect_wallet'); }} className={btnBase}>
      Connect Wallet
    </button>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  if (chain === 'stellar') return <StellarButton />;
  if (chain === 'solana') return <SolanaButton />;
  if (chain === 'ckb') return <CkbButton />;
  return <HorizenButton />;
}
