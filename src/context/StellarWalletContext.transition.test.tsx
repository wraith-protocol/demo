// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ChainContext } from '@/context/ChainContext';
import { STELLAR_NETWORK } from '@/config';
import { WalletContextChangedError } from '@/wallets/session';
import { StellarWalletProvider, useStellarWallet } from './StellarWalletContext';

const ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER_ACCOUNT = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBH6';

type WalletContext = ReturnType<typeof useStellarWallet>;

let walletContext: WalletContext;
let watcherCallback:
  | ((change: {
      address?: string;
      network?: string;
      networkPassphrase?: string;
      error?: unknown;
    }) => void)
  | undefined;

function Probe() {
  walletContext = useStellarWallet();
  return null;
}

function wrap(children: ReactNode) {
  return (
    <ChainContext.Provider value={{ chain: 'stellar', setChain: () => undefined }}>
      {children}
    </ChainContext.Provider>
  );
}

function createFreighterMock(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: vi.fn(async () => ({ isConnected: true })),
    isAllowed: vi.fn(async () => ({ isAllowed: true })),
    getAddress: vi.fn(async () => ({ address: ACCOUNT })),
    getNetworkDetails: vi.fn(async () => ({
      network: 'TESTNET',
      networkPassphrase: STELLAR_NETWORK.networkPassphrase,
    })),
    requestAccess: vi.fn(async () => ({ address: ACCOUNT })),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    WatchWalletChanges: class {
      watch(callback: typeof watcherCallback) {
        watcherCallback = callback;
      }
      stop() {}
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount(freighterMock: ReturnType<typeof createFreighterMock>) {
  (window as unknown as Record<string, unknown>).freighterMock = freighterMock;
  render(
    wrap(
      <StellarWalletProvider>
        <Probe />
      </StellarWalletProvider>,
    ),
  );
  await waitFor(() => expect(walletContext.address).toBe(ACCOUNT));
}

afterEach(() => {
  cleanup();
  watcherCallback = undefined;
  delete (window as unknown as Record<string, unknown>).freighterMock;
  vi.unstubAllGlobals();
});

describe('StellarWalletContext wallet transitions', () => {
  it('rejects a message that was signed after the account changed', async () => {
    const signature = deferred<Uint8Array>();
    const freighter = createFreighterMock({
      signMessage: vi.fn(() => signature.promise),
    });
    await mount(freighter);

    const pending = walletContext.signMessage('derive stealth keys');
    const rejection = expect(pending).rejects.toBeInstanceOf(WalletContextChangedError);
    await waitFor(() => expect(freighter.signMessage).toHaveBeenCalled());

    act(() => watcherCallback?.({ address: OTHER_ACCOUNT }));
    await act(async () => {
      signature.resolve(new Uint8Array(64).fill(1));
    });

    await rejection;
    expect(freighter.signMessage).toHaveBeenCalledWith(
      'derive stealth keys',
      expect.objectContaining({ address: ACCOUNT }),
    );
    expect(walletContext.address).toBe(OTHER_ACCOUNT);
  });

  it('rejects a transaction that was signed after the network changed', async () => {
    const signed = deferred<string>();
    const freighter = createFreighterMock({
      signTransaction: vi.fn(() => signed.promise),
    });
    await mount(freighter);

    const pending = walletContext.signTransaction('AAAA');
    const rejection = expect(pending).rejects.toBeInstanceOf(WalletContextChangedError);
    await waitFor(() => expect(freighter.signTransaction).toHaveBeenCalled());

    act(() =>
      watcherCallback?.({
        address: ACCOUNT,
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      }),
    );
    await act(async () => {
      signed.resolve('signed-xdr');
    });

    await rejection;
    expect(walletContext.address).toBe(ACCOUNT);
  });

  it('does not return a transaction signed after disconnect', async () => {
    const signed = deferred<string>();
    const freighter = createFreighterMock({
      signTransaction: vi.fn(() => signed.promise),
    });
    await mount(freighter);

    const pending = walletContext.signTransaction('AAAA');
    const rejection = expect(pending).rejects.toBeInstanceOf(WalletContextChangedError);
    await waitFor(() => expect(freighter.signTransaction).toHaveBeenCalled());

    act(() => walletContext.disconnect());
    await act(async () => {
      signed.resolve('signed-xdr');
    });

    await rejection;
    expect(walletContext.address).toBeNull();
  });
});
