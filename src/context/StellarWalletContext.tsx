import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getStellarNetwork, STELLAR_NETWORKS } from '@/config';
import type { StellarNetwork } from '@/config';
import { useStealthKeys } from '@/context/StealthKeysContext';

const CHANNEL_NAME = 'wraith-stellar-wallet';
const NETWORK_STORAGE_KEY = 'wraith:stellar-network';
const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';

type WalletStatus = 'checking' | 'not-installed' | 'needs-approval' | 'disconnected' | 'connected';

interface WalletSyncMessage {
  type: 'session' | 'disconnect';
  address?: string;
  network?: string;
}

interface StellarWalletContextValue {
  address: string | null;
  isConnected: boolean;
  status: WalletStatus;
  network: StellarNetwork;
  installUrl: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  retryInstall: () => void;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (xdr: string) => Promise<string>;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

function getStoredNetwork() {
  const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
  return stored ? getStellarNetwork(stored) : STELLAR_NETWORKS.testnet;
}

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const { clearStellar } = useStealthKeys();
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>('checking');
  const [network, setNetwork] = useState<StellarNetwork>(getStoredNetwork);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const addressRef = useRef<string | null>(null);
  const networkRef = useRef(network);
  const suppressReconnectRef = useRef(false);
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watcherRef = useRef<{ stop: () => void } | null>(null);

  const clearInstallPoll = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  const updateSession = useCallback(
    (nextAddress: string | null, freighterNetwork?: string, broadcast = true) => {
      const nextNetwork = freighterNetwork
        ? getStellarNetwork(freighterNetwork)
        : networkRef.current;
      const walletChanged = addressRef.current !== nextAddress;
      const networkChanged = networkRef.current.id !== nextNetwork.id;

      if (walletChanged || networkChanged) clearStellar();

      addressRef.current = nextAddress;
      networkRef.current = nextNetwork;
      setAddress(nextAddress);
      setNetwork(nextNetwork);
      localStorage.setItem(NETWORK_STORAGE_KEY, nextNetwork.freighterName);

      if (nextAddress) {
        setStatus('connected');
      } else {
        setStatus('disconnected');
      }

      if (broadcast) {
        channelRef.current?.postMessage({
          type: nextAddress ? 'session' : 'disconnect',
          address: nextAddress || undefined,
          network: nextNetwork.freighterName,
        } satisfies WalletSyncMessage);
      }
    },
    [clearStellar],
  );

  const checkFreighter = useCallback(
    async (restore: boolean) => {
      const freighter = await import('@stellar/freighter-api');
      const { isConnected } = await freighter.isConnected();
      if (!isConnected) {
        setStatus('not-installed');
        return false;
      }

      clearInstallPoll();
      const { isAllowed } = await freighter.isAllowed();
      if (!isAllowed) {
        setStatus('needs-approval');
        return true;
      }

      const { network: freighterNetwork } = await freighter.getNetwork();
      if (restore && !suppressReconnectRef.current) {
        const { address: nextAddress } = await freighter.getAddress();
        updateSession(nextAddress || null, freighterNetwork);
      } else if (!addressRef.current) {
        setStatus('disconnected');
      }
      return true;
    },
    [clearInstallPoll, updateSession],
  );

  const startWatcher = useCallback(async () => {
    if (watcherRef.current) return;
    const freighter = await import('@stellar/freighter-api');
    const watcher = new freighter.WatchWalletChanges(1000);
    watcher.watch(({ address: nextAddress, network: freighterNetwork }) => {
      if (suppressReconnectRef.current) return;
      updateSession(nextAddress || null, freighterNetwork);
    });
    watcherRef.current = watcher;
  }, [updateSession]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = ({ data }: MessageEvent<WalletSyncMessage>) => {
      if (data.type === 'disconnect') {
        suppressReconnectRef.current = true;
        updateSession(null, data.network, false);
      } else if (data.address) {
        suppressReconnectRef.current = false;
        updateSession(data.address, data.network, false);
      }
    };

    (async () => {
      try {
        if (!(await checkFreighter(true))) return;
        await startWatcher();
      } catch {
        setStatus('not-installed');
      }
    })();

    return () => {
      watcherRef.current?.stop();
      watcherRef.current = null;
      clearInstallPoll();
      channel.close();
      channelRef.current = null;
    };
  }, [checkFreighter, clearInstallPoll, startWatcher, updateSession]);

  const connect = useCallback(async () => {
    const freighter = await import('@stellar/freighter-api');
    const { isConnected } = await freighter.isConnected();
    if (!isConnected) {
      setStatus('not-installed');
      throw new Error('Freighter wallet not found. Install Freighter, then retry.');
    }

    const { address: nextAddress, error } = await freighter.requestAccess();
    if (!nextAddress) {
      setStatus('needs-approval');
      throw new Error(error || 'Approve this app in Freighter to connect your wallet.');
    }

    const { network: freighterNetwork } = await freighter.getNetwork();
    suppressReconnectRef.current = false;
    updateSession(nextAddress, freighterNetwork);
    await startWatcher();
  }, [startWatcher, updateSession]);

  const disconnect = useCallback(() => {
    suppressReconnectRef.current = true;
    updateSession(null);
  }, [updateSession]);

  const retryInstall = useCallback(() => {
    clearInstallPoll();
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt >= 30_000) {
        clearInstallPoll();
        return;
      }
      try {
        if (await checkFreighter(false)) {
          clearInstallPoll();
          await startWatcher();
        }
      } catch {
        // The extension injects its bridge asynchronously after installation.
      }
    };
    void poll();
    installPollRef.current = setInterval(poll, 2000);
  }, [checkFreighter, clearInstallPoll, startWatcher]);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedMessage } = await freighter.signMessage(message, {
        address,
        networkPassphrase: network.networkPassphrase,
      });

      if (!signedMessage) throw new Error('Signing failed: no signature returned');
      const msg = signedMessage as unknown;

      if (msg instanceof Uint8Array) return msg;

      if (typeof msg === 'string') {
        const binaryString = atob(msg);
        return Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
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
        `Unexpected signedMessage type: ${typeof msg} - ${JSON.stringify(msg).slice(0, 200)}`,
      );
    },
    [address, network.networkPassphrase],
  );

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedTxXdr } = await freighter.signTransaction(xdr, {
        address,
        networkPassphrase: network.networkPassphrase,
      });

      return signedTxXdr;
    },
    [address, network.networkPassphrase],
  );

  return (
    <StellarWalletContext.Provider
      value={{
        address,
        isConnected: !!address,
        status,
        network,
        installUrl: FREIGHTER_INSTALL_URL,
        connect,
        disconnect,
        retryInstall,
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
