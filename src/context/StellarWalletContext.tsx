import { createContext, useContext } from 'react';
import { STELLAR_NETWORK } from '@/config';
import { useStellarWallet as useStellarWalletHook } from '@/hooks/useStellarWallet';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { STELLAR_NETWORK } from '@/config';
import { useChain } from '@/context/ChainContext';

const CHANNEL_NAME = 'wraith:stellar-wallet';

interface StellarWalletContextValue {
  address: string | null;
  isConnected: boolean;
  isInstalled: boolean | null; // null while the initial extension check is in-flight
  isNetworkMismatch: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (xdr: string) => Promise<string>;
  openPicker: () => void;
  closePicker: () => void;
  walletId: string | null;
  subscribeToDisconnect: (cb: () => void) => () => void;
}

export const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const stellarWallet = useStellarWalletHook();

  // Legacy signMessage - only supported by Freighter currently
  const signMessage = async (message: string): Promise<Uint8Array> => {
    // For now, signMessage is only implemented for Freighter
    // Other wallets don't support arbitrary message signing in the same way
    throw new Error('Message signing is currently only supported by Freighter wallet');
  };
  const { chain } = useChain();
  const [address, setAddress] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [freighterPassphrase, setFreighterPassphrase] = useState<string | null>(null);

  const tabId = useRef(crypto.randomUUID());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const passPhraseRef = useRef<string | null>(null);
  const addressRef = useRef<string | null>(null);
  const disconnectListeners = useRef<(() => void)[]>([]);
  // Tracks explicit user-initiated disconnects so WatchWalletChanges cannot silently
  // re-connect after the user clicks Disconnect (Freighter has no revoke API).
  const manuallyDisconnected = useRef(false);

  const isConnected = !!address;
  const isNetworkMismatch =
    freighterPassphrase !== null &&
    freighterPassphrase !== STELLAR_NETWORK.networkPassphrase;

  // Isolated per-listener invocation so one throwing callback never blocks the rest
  // or the BroadcastChannel broadcast that follows.
  const fireListeners = useCallback(() => {
    disconnectListeners.current.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }, []);

  // Cross-tab sync via BroadcastChannel
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (e) => {
      // tabId guard prevents infinite broadcast loops between tabs
      if (e.data.origin === tabId.current) return;
      switch (e.data.type as string) {
        case 'CONNECTED':
          manuallyDisconnected.current = false;
          setAddress(e.data.address as string);
          addressRef.current = e.data.address as string;
          setIsInstalled(true);
          break;
        case 'DISCONNECTED':
          // Propagate manual disconnect intent so this tab's watcher also ignores Freighter
          manuallyDisconnected.current = true;
          setAddress(null);
          addressRef.current = null;
          fireListeners();
          break;
        case 'NETWORK_CHANGED': {
          const pass = e.data.passphrase as string;
          setFreighterPassphrase(pass);
          passPhraseRef.current = pass;
          fireListeners();
          break;
        }
      }
    };
    return () => {
      channel.close();
      channelRef.current = null; // prevent postMessage on closed channel (InvalidStateError)
    };
  }, [fireListeners]);

  // Session restore + WatchWalletChanges — only active while on the Stellar chain.
  // When the chain selector changes away, the watcher stops immediately.
  useEffect(() => {
    if (chain !== 'stellar') return;

    let stopped = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let watcher: { stop: () => void } | null = null;

    const tryInit = async () => {
      if (stopped) return;
      try {
        const freighter = await import('@stellar/freighter-api');
        const { isConnected: connected } = await freighter.isConnected();

        if (!connected) {
          setIsInstalled(false);
          retryTimeout = setTimeout(tryInit, 3000);
          return;
        }

        setIsInstalled(true);

        const details = await freighter.getNetworkDetails();
        const pass = details.networkPassphrase ?? '';
        if (pass) {
          setFreighterPassphrase(pass);
          passPhraseRef.current = pass;
        }

        // Restore silently only if user has not explicitly disconnected this session
        const { isAllowed: allowed } = await freighter.isAllowed();
        if (allowed && !manuallyDisconnected.current) {
          const { address: addr } = await freighter.getAddress();
          if (addr && addr !== addressRef.current) {
            setAddress(addr);
            addressRef.current = addr;
            channelRef.current?.postMessage({
              type: 'CONNECTED',
              address: addr,
              origin: tabId.current,
            });
          }
        }

        if (stopped) return;

        const w = new freighter.WatchWalletChanges(3000);
        watcher = w;
        w.watch(({ address: newAddr, networkPassphrase: newPass, error }) => {
          if (stopped || error) return;

          const prevAddr = addressRef.current;
          const currentAddr = newAddr || null;

          if (newPass && newPass !== passPhraseRef.current) {
            passPhraseRef.current = newPass;
            setFreighterPassphrase(newPass);
            fireListeners();
            channelRef.current?.postMessage({
              type: 'NETWORK_CHANGED',
              passphrase: newPass,
              origin: tabId.current,
            });
          }

          // Skip address sync when the user deliberately disconnected — Freighter has no
          // revoke API, so it always reports the active address even after our UI disconnect.
          if (currentAddr !== prevAddr && !manuallyDisconnected.current) {
            addressRef.current = currentAddr;
            setAddress(currentAddr);
            if (!currentAddr) {
              fireListeners();
              channelRef.current?.postMessage({ type: 'DISCONNECTED', origin: tabId.current });
            } else if (prevAddr) {
              fireListeners();
              channelRef.current?.postMessage({
                type: 'CONNECTED',
                address: currentAddr,
                origin: tabId.current,
              });
            }
          }
        });
      } catch {
        // Guard against scheduling a retry after cleanup already ran
        if (stopped) return;
        setIsInstalled(false);
        retryTimeout = setTimeout(tryInit, 5000);
      }
    };

    tryInit();

    return () => {
      stopped = true;
      watcher?.stop();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [chain, fireListeners]);

  const subscribeToDisconnect = useCallback((cb: () => void) => {
    disconnectListeners.current.push(cb);
    return () => {
      disconnectListeners.current = disconnectListeners.current.filter((f) => f !== cb);
    };
  }, []);

  const connect = useCallback(async () => {
    const freighter = await import('@stellar/freighter-api');
    const { isConnected: connected } = await freighter.isConnected();
    if (!connected) {
      throw new Error(
        'Freighter wallet not found. Please install the Freighter browser extension.',
      );
    }

    await freighter.requestAccess();
    const { address: addr } = await freighter.getAddress();
    if (!addr) throw new Error('Failed to get public key from Freighter');

    // Commit the address immediately after approval so the UI unblocks even if
    // getNetworkDetails is slow or fails (it's best-effort here).
    manuallyDisconnected.current = false;
    setAddress(addr);
    addressRef.current = addr;

    try {
      const details = await freighter.getNetworkDetails();
      const pass = details.networkPassphrase ?? '';
      if (pass) {
        setFreighterPassphrase(pass);
        passPhraseRef.current = pass;
      }
    } catch {
      // Non-fatal: the watcher will update the passphrase on its next 3s cycle
    }

    channelRef.current?.postMessage({
      type: 'CONNECTED',
      address: addr,
      origin: tabId.current,
    });
  }, []);

  const disconnect = useCallback(() => {
    manuallyDisconnected.current = true;
    setAddress(null);
    addressRef.current = null;
    fireListeners();
    channelRef.current?.postMessage({ type: 'DISCONNECTED', origin: tabId.current });
  }, [fireListeners]);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedMessage } = await freighter.signMessage(message, {
        address,
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      });

      if (!signedMessage) throw new Error('Signing failed: no signature returned');

      const msg = signedMessage as unknown;

      if (msg instanceof Uint8Array) {
        return msg;
      }

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
    [address],
  );

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedTxXdr } = await freighter.signTransaction(xdr, {
        address,
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      });

      return signedTxXdr;
    },
    [address],
  );

  return (
    <StellarWalletContext.Provider
      value={{
        address: stellarWallet.publicKey,
        isConnected: stellarWallet.status === 'connected',
        connect: async () => {
          // If no wallet is selected, open picker
          if (!stellarWallet.walletId) {
            stellarWallet.openPicker();
            return;
          }
          // Otherwise reconnect with existing wallet
          if (stellarWallet.walletId) {
            await stellarWallet.connect(stellarWallet.walletId);
          }
        },
        disconnect: () => stellarWallet.disconnect(),
        signMessage,
        signTransaction: stellarWallet.signTransaction,
        openPicker: stellarWallet.openPicker,
        closePicker: stellarWallet.closePicker,
        walletId: stellarWallet.walletId,
        address,
        isConnected,
        isInstalled,
        isNetworkMismatch,
        connect,
        disconnect,
        signMessage,
        signTransaction,
        subscribeToDisconnect,
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
