import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ccc } from '@ckb-ccc/connector-react';
import { useTranslation } from 'react-i18next';
import { useChain } from '@/context/ChainContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { trackEvent } from '@/lib/telemetry';
import { StellarLink } from '@/components/StellarLink';

const btnBase =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-50 sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';
const btnConnected =
  'bg-transparent border border-outline-variant px-3 py-1.5 font-mono text-[10px] text-primary transition-colors hover:bg-surface-bright sm:px-4 sm:py-2 sm:text-xs h-8 sm:h-9';

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
              <button
                onClick={() => {
                  openConnectModal();
                  trackEvent('connect_wallet');
                }}
                className={btnBase}
              >
                {t('walletConnect.connectWallet')}
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
  const { t } = useTranslation();
  const { address, isConnected, connect, disconnect } = useStellarWallet();
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setError(null);
    setIsConnecting(true);
    try {
      await connect();
      trackEvent('connect_wallet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  if (isConnected && address) {
    return (
      <div className={`${btnConnected} flex items-center gap-2`}>
        <StellarLink value={address} type="account" linkClassName="text-[10px] sm:text-xs">
          {address.slice(0, 4)}...{address.slice(-4)}
        </StellarLink>
        <button
          type="button"
          onClick={disconnect}
          className="text-outline transition-colors hover:text-error"
          aria-label="Disconnect Stellar wallet"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={handleConnect} disabled={isConnecting} className={btnBase}>
        {isConnecting ? t('walletConnect.connecting') : t('walletConnect.connectFreighter')}
      </button>
      {error && <span className="text-[10px] text-error font-mono">{error}</span>}
    </div>
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
    <button
      onClick={() => {
        open();
        trackEvent('connect_wallet');
      }}
      className={btnBase}
    >
      {t('walletConnect.connectWallet')}
    </button>
  );
}

export function WalletConnect() {
  const { chain } = useChain();

  return (
    <div data-tour="wallet-connect">
      {chain === 'stellar' ? (
        <StellarButton />
      ) : chain === 'solana' ? (
        <SolanaButton />
      ) : chain === 'ckb' ? (
        <CkbButton />
      ) : (
        <HorizenButton />
      )}
    </div>
  );
}
