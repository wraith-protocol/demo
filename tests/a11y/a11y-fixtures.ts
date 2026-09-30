import { test as base } from '@playwright/test';

export const test = base.extend({});

/**
 * Install a connected Freighter mock.
 *
 * Re-exported from `tests/fixtures` so every spec shares one mock. The app reads
 * `window.freighterMock` (`StellarWalletContext#getFreighter`); the real
 * `@stellar/freighter-api` package only treats `window.freighter` as a boolean
 * "is installed" flag, so mocking `window.freighter` with an object mocks nothing.
 */
export { mockConnectedWallet } from '../fixtures';

export { expect } from '@playwright/test';
