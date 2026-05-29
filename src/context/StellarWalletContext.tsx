import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { STELLAR_NETWORK } from '@/config';

type FreighterStatus = 'checking' | 'ready' | 'not_installed' | 'not_allowed' | 'error';
type StellarNetworkPreference = 'testnet' | 'futurenet' | 'mainnet';

interface StellarWalletContextValue {
  address: string | null;
  isConnected: boolean;
  status: FreighterStatus;
  statusMessage: string;
  network: string | null;
  networkPassphrase: string | null;
  preferredNetwork: StellarNetworkPreference;
  setPreferredNetwork: (network: StellarNetworkPreference) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  retryInstallDetection: () => void;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (xdr: string) => Promise<string>;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);
const STORAGE_KEY = 'wraith:stellar:preferred-network';
const CHANNEL_NAME = 'wraith:stellar-wallet';

type BroadcastMessage =
  | {
      type: 'connected';
      address: string | null;
      network: string | null;
      networkPassphrase: string | null;
    }
  | { type: 'disconnected' }
  | { type: 'network'; network: string | null; networkPassphrase: string | null }
  | { type: 'preferred-network'; preferredNetwork: StellarNetworkPreference };

type WalletChangePayload = {
  address: string;
  network: string;
  networkPassphrase: string;
};

type WalletWatcher = {
  watch: (callback: (payload: WalletChangePayload) => void) => void;
  stop: () => void;
};

function getInitialPreferredNetwork(): StellarNetworkPreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'testnet' || stored === 'futurenet' || stored === 'mainnet') return stored;
  return 'testnet';
}

function clearStellarStealthKeys() {
  window.dispatchEvent(new Event('stellar:clear-stealth-keys'));
}

function networkToPreference(network: string): StellarNetworkPreference | null {
  const normalized = network.toLowerCase();
  if (normalized.includes('test')) return 'testnet';
  if (normalized.includes('future')) return 'futurenet';
  if (normalized.includes('public') || normalized.includes('main')) return 'mainnet';
  return null;
}

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<FreighterStatus>('checking');
  const [statusMessage, setStatusMessage] = useState('');
  const [network, setNetwork] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null);
  const [preferredNetwork, setPreferredNetworkState] = useState<StellarNetworkPreference>(
    getInitialPreferredNetwork,
  );

  const isConnected = !!address;

  const broadcast = useCallback((message: BroadcastMessage) => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  }, []);

  const setPreferredNetwork = useCallback(
    (nextNetwork: StellarNetworkPreference) => {
      localStorage.setItem(STORAGE_KEY, nextNetwork);
      setPreferredNetworkState(nextNetwork);
      broadcast({ type: 'preferred-network', preferredNetwork: nextNetwork });
    },
    [broadcast],
  );

  const restoreIfAllowed = useCallback(async () => {
    try {
      setStatus('checking');
      const freighter = await import('@stellar/freighter-api');
      const { isConnected: connected } = await freighter.isConnected();
      if (!connected) {
        setStatus('not_installed');
        setStatusMessage('Install Freighter to connect a Stellar wallet.');
        return false;
      }

      const { isAllowed: allowed } = await freighter.isAllowed();
      if (!allowed) {
        setStatus('not_allowed');
        setStatusMessage('Approve this site in Freighter to reconnect.');
        return false;
      }

      const { address: addr } = await freighter.getAddress();
      const details = await freighter.getNetworkDetails();
      const nextPreference = details.network ? networkToPreference(details.network) : null;
      if (nextPreference) {
        localStorage.setItem(STORAGE_KEY, nextPreference);
        setPreferredNetworkState(nextPreference);
      }

      setNetwork(details.network || null);
      setNetworkPassphrase(details.networkPassphrase || null);

      if (!addr) {
        setStatus('not_allowed');
        setStatusMessage('Approve this site in Freighter to reconnect.');
        return false;
      }

      setAddress(addr);
      setStatus('ready');
      setStatusMessage('');
      broadcast({
        type: 'connected',
        address: addr,
        network: details.network || null,
        networkPassphrase: details.networkPassphrase || null,
      });
      return true;
    } catch {
      setStatus('not_installed');
      setStatusMessage('Install Freighter to connect a Stellar wallet.');
      return false;
    }
  }, [broadcast]);

  useEffect(() => {
    void restoreIfAllowed();
  }, [restoreIfAllowed]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const message = event.data;
      if (message.type === 'connected') {
        setAddress(message.address);
        setNetwork(message.network);
        setNetworkPassphrase(message.networkPassphrase);
        setStatus(message.address ? 'ready' : 'not_allowed');
        setStatusMessage('');
      }
      if (message.type === 'disconnected') {
        setAddress(null);
        clearStellarStealthKeys();
      }
      if (message.type === 'network') {
        setNetwork(message.network);
        setNetworkPassphrase(message.networkPassphrase);
        clearStellarStealthKeys();
      }
      if (message.type === 'preferred-network') {
        setPreferredNetworkState(message.preferredNetwork);
      }
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    let watcher: WalletWatcher | null = null;

    (async () => {
      try {
        const freighter = await import('@stellar/freighter-api');
        watcher = new freighter.WatchWalletChanges(2000) as WalletWatcher;
        watcher.watch(
          ({ address: nextAddress, network: nextNetwork, networkPassphrase: nextPassphrase }) => {
            if (nextAddress && nextAddress !== address) {
              setAddress(nextAddress);
              clearStellarStealthKeys();
              broadcast({
                type: 'connected',
                address: nextAddress,
                network: nextNetwork || null,
                networkPassphrase: nextPassphrase || null,
              });
            }
            if (nextNetwork && nextNetwork !== network) {
              setNetwork(nextNetwork);
              setNetworkPassphrase(nextPassphrase || null);
              const nextPreference = networkToPreference(nextNetwork);
              if (nextPreference) {
                localStorage.setItem(STORAGE_KEY, nextPreference);
                setPreferredNetworkState(nextPreference);
              }
              clearStellarStealthKeys();
              broadcast({
                type: 'network',
                network: nextNetwork,
                networkPassphrase: nextPassphrase || null,
              });
            }
          },
        );
      } catch {
        // Freighter watcher becomes available only after the extension exists.
      }
    })();

    return () => watcher?.stop();
  }, [address, network, broadcast]);

  const connect = useCallback(async () => {
    const freighter = await import('@stellar/freighter-api');
    const { isConnected: connected } = await freighter.isConnected();
    if (!connected) {
      setStatus('not_installed');
      setStatusMessage('Install Freighter to connect a Stellar wallet.');
      throw new Error(
        'Freighter wallet not found. Please install the Freighter browser extension.',
      );
    }

    await freighter.requestAccess();
    const { address: addr } = await freighter.getAddress();
    if (!addr) throw new Error('Failed to get public key from Freighter');
    const details = await freighter.getNetworkDetails();
    const nextPreference = details.network ? networkToPreference(details.network) : null;
    if (nextPreference) setPreferredNetwork(nextPreference);

    setAddress(addr);
    setNetwork(details.network || null);
    setNetworkPassphrase(details.networkPassphrase || null);
    setStatus('ready');
    setStatusMessage('');
    broadcast({
      type: 'connected',
      address: addr,
      network: details.network || null,
      networkPassphrase: details.networkPassphrase || null,
    });
  }, [broadcast, setPreferredNetwork]);

  const disconnect = useCallback(() => {
    setAddress(null);
    clearStellarStealthKeys();
    broadcast({ type: 'disconnected' });
  }, [broadcast]);

  const retryInstallDetection = useCallback(() => {
    let attempts = 0;
    const interval = window.setInterval(async () => {
      attempts++;
      const restored = await restoreIfAllowed();
      if (restored || attempts >= 15) window.clearInterval(interval);
    }, 2000);
  }, [restoreIfAllowed]);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedMessage } = await freighter.signMessage(message, {
        address,
        networkPassphrase: networkPassphrase ?? STELLAR_NETWORK.networkPassphrase,
      });

      if (!signedMessage) throw new Error('Signing failed: no signature returned');

      const msg = signedMessage as unknown;
      if (msg instanceof Uint8Array) return msg;

      if (typeof msg === 'string') {
        const binaryString = atob(msg);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }

      if (
        msg &&
        typeof msg === 'object' &&
        'data' in msg &&
        Array.isArray((msg as Record<string, unknown>).data)
      ) {
        return new Uint8Array((msg as { data: number[] }).data);
      }

      throw new Error(
        `Unexpected signedMessage type: ${typeof msg} — ${JSON.stringify(msg).slice(0, 200)}`,
      );
    },
    [address, networkPassphrase],
  );

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedTxXdr } = await freighter.signTransaction(xdr, {
        address,
        networkPassphrase: networkPassphrase ?? STELLAR_NETWORK.networkPassphrase,
      });

      return signedTxXdr;
    },
    [address, networkPassphrase],
  );

  return (
    <StellarWalletContext.Provider
      value={{
        address,
        isConnected,
        status,
        statusMessage,
        network,
        networkPassphrase,
        preferredNetwork,
        setPreferredNetwork,
        connect,
        disconnect,
        retryInstallDetection,
        signMessage,
        signTransaction,
      }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
}

export function useStellarWallet() {
  const ctx = useContext(StellarWalletContext);
  if (!ctx) throw new Error('useStellarWallet must be used within StellarWalletProvider');
  return ctx;
}
