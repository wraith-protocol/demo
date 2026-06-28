import type { Decorator } from '@storybook/react';
import { StellarWalletContext } from '@/context/StellarWalletContext';

interface StellarWalletOverrides {
  address?: string | null;
  isConnected?: boolean;
  isInstalled?: boolean | null;
  isNetworkMismatch?: boolean;
  connect?: () => Promise<void>;
  disconnect?: () => void;
  signMessage?: (message: string) => Promise<Uint8Array>;
  signTransaction?: (xdr: string) => Promise<string>;
  subscribeToDisconnect?: (cb: () => void) => () => void;
}

/**
 * Provides a fake StellarWalletContext with stubbed async methods, so no story
 * ever touches Freighter or the network. Pass `address` to simulate a connected
 * wallet; `isConnected` defaults to `address !== null`.
 */
export function withStellarWallet(overrides: StellarWalletOverrides = {}): Decorator {
  const address = overrides.address ?? null;
  const value = {
    address,
    isConnected: overrides.isConnected ?? address !== null,
    isInstalled: overrides.isInstalled !== undefined ? overrides.isInstalled : true,
    isNetworkMismatch: overrides.isNetworkMismatch ?? false,
    connect: overrides.connect ?? (async () => {}),
    disconnect: overrides.disconnect ?? (() => {}),
    signMessage: overrides.signMessage ?? (async () => new Uint8Array(64)),
    signTransaction: overrides.signTransaction ?? (async () => ''),
    subscribeToDisconnect: overrides.subscribeToDisconnect ?? ((_cb: () => void) => () => {}),
  };
  return function StellarWalletDecorator(Story) {
    return (
      <StellarWalletContext.Provider value={value}>
        <Story />
      </StellarWalletContext.Provider>
    );
  };
}
