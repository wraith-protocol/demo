import { test as base, type Page } from '@playwright/test';

/**
 * Shared Playwright helpers for specs that render a Stellar screen.
 *
 * Two things used to trip every Stellar spec:
 *
 * 1. The app reads `window.freighterMock` (see `getFreighter()` in
 *    `src/context/StellarWalletContext.tsx`). `@stellar/freighter-api` only looks
 *    at `window.freighter` as a boolean "is installed" flag and otherwise talks to
 *    the extension over `postMessage`, so a hand-rolled `window.freighter` object
 *    mocks nothing.
 * 2. The app boots on the Horizen chain. Stellar screens such as `/vault` render a
 *    "switch to Stellar" placeholder until the header chain switcher is changed.
 */

export const MOCK_STELLAR_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';

const MOCK_NETWORK = {
  network: 'TESTNET',
  networkName: 'Testnet',
  networkUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
};

const MOCK_SIGNED_MESSAGE =
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export interface FreighterMockOptions {
  address?: string;
  /** `false` simulates Freighter not being installed. */
  isConnected?: boolean;
  /** `false` simulates the user having granted no access yet. */
  isAllowed?: boolean;
  shouldFailConnect?: boolean;
  shouldFailSignMessage?: boolean;
  shouldFailSignTx?: boolean;
  signedMessage?: string;
}

/**
 * Install a Freighter mock covering the whole surface `StellarWalletContext`
 * touches: connection probes, network details and the wallet-change watcher.
 *
 * Call before `page.goto()` so the mock is present on first paint.
 */
export async function mockFreighter(page: Page, options: FreighterMockOptions = {}) {
  const config = {
    address: options.address ?? MOCK_STELLAR_ADDRESS,
    isConnected: options.isConnected !== false,
    isAllowed: options.isAllowed !== false,
    shouldFailConnect: options.shouldFailConnect ?? false,
    shouldFailSignMessage: options.shouldFailSignMessage ?? false,
    shouldFailSignTx: options.shouldFailSignTx ?? false,
    signedMessage: options.signedMessage ?? MOCK_SIGNED_MESSAGE,
    network: MOCK_NETWORK,
  };

  await page.addInitScript((cfg) => {
    (window as any).freighterMock = {
      isConnected: async () => ({ isConnected: cfg.isConnected }),
      isAllowed: async () => ({ isAllowed: cfg.isAllowed }),
      getAddress: async () => ({ address: cfg.isAllowed ? cfg.address : '' }),
      getPublicKey: async () => cfg.address,
      getUserInfo: async () => ({ publicKey: cfg.address }),
      requestAccess: async () => {
        if (cfg.shouldFailConnect) throw new Error('User rejected connection');
        return { address: cfg.address };
      },
      getNetworkDetails: async () => cfg.network,
      getNetwork: async () => ({
        network: cfg.network.network,
        networkPassphrase: cfg.network.networkPassphrase,
      }),
      signMessage: async () => {
        if (cfg.shouldFailSignMessage) throw new Error('User rejected signature');
        return { signedMessage: cfg.signedMessage };
      },
      signTransaction: async (xdr: string) => {
        if (cfg.shouldFailSignTx) throw new Error('User rejected transaction signing');
        return { signedTxXdr: xdr };
      },
      // `watch()` intentionally never emits: tests must not race a poller.
      WatchWalletChanges: class {
        watch() {
          return {};
        }
        stop() {}
      },
    };
  }, config);
}

/** Mock a connected, allowed wallet. */
export async function mockConnectedWallet(page: Page, options: FreighterMockOptions = {}) {
  await mockFreighter(page, { isConnected: true, isAllowed: true, ...options });
}

/**
 * Select a chain in the header switcher.
 *
 * The page has more than one `<select>` (the locale switcher is the first), so
 * scope the locator to the select that actually offers the requested value.
 */
export async function selectChain(page: Page, chain: 'horizen' | 'stellar' | 'solana' | 'ckb') {
  await page
    .locator('select')
    .filter({ has: page.locator(`option[value="${chain}"]`) })
    .selectOption(chain);
}

/**
 * Dismiss the cookie/telemetry banner so it cannot intercept clicks. The banner
 * only renders while consent is unset (`src/components/TelemetryBanner.tsx`).
 */
export async function dismissTelemetryBanner(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('wraith-telemetry-consent', 'declined');
  });
}

/** Mock a connected wallet and silence the consent banner. */
export async function setupStellarWallet(page: Page, options: FreighterMockOptions = {}) {
  await dismissTelemetryBanner(page);
  await mockConnectedWallet(page, options);
}

/**
 * Navigate and then select the Stellar chain.
 *
 * `ChainContext` keeps the active chain in memory only, so every navigation
 * resets it to Horizen and the Stellar screens fall back to their "switch chain"
 * placeholder. Always use this instead of a bare `page.goto()` in Stellar specs.
 */
export async function gotoStellar(page: Page, path: string) {
  await page.goto(path);
  await selectChain(page, 'stellar');
}

export const test = base;

export { expect } from '@playwright/test';
