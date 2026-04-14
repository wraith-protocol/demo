import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { STELLAR_NETWORK } from '@/config';

interface StellarWalletContextValue {
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (xdr: string) => Promise<string>;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  const isConnected = !!address;

  useEffect(() => {
    (async () => {
      try {
        const freighter = await import('@stellar/freighter-api');
        const { isConnected: connected } = await freighter.isConnected();
        if (connected) {
          const { address: addr } = await freighter.getAddress();
          if (addr) setAddress(addr);
        }
      } catch {
        // Freighter not available
      }
    })();
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
    setAddress(addr);
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array> => {
      if (!address) throw new Error('Wallet not connected');

      const freighter = await import('@stellar/freighter-api');
      const { signedMessage } = await freighter.signMessage(message, {
        address,
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      });

      if (!signedMessage) throw new Error('Signing failed: no signature returned');

      // Freighter v3 returns Buffer, v4 returns base64 string
      if (typeof signedMessage !== 'string') {
        return new Uint8Array(signedMessage);
      }
      const binaryString = atob(signedMessage);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
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
      value={{ address, isConnected, connect, disconnect, signMessage, signTransaction }}
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
