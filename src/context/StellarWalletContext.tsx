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

      // Freighter returns different types depending on version:
      // - v3: Buffer (may arrive as serialized {type:'Buffer', data:[...]} through extension messaging)
      // - v4: base64 string
      // - could also be a raw Uint8Array/Buffer instance
      const msg = signedMessage as unknown;

      if (msg instanceof Uint8Array) {
        return msg;
      }

      if (typeof msg === 'string') {
        // base64 string
        const binaryString = atob(msg);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }

      // Serialized Buffer: {type: 'Buffer', data: [1, 2, 3, ...]}
      if (
        msg &&
        typeof msg === 'object' &&
        'data' in msg &&
        Array.isArray((msg as Record<string, unknown>).data)
      ) {
        return new Uint8Array((msg as { data: number[] }).data);
      }

      // Last resort: try to convert whatever it is
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
