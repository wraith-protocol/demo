import { test as base } from '@playwright/test';

const MOCK_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';

export const test = base.extend({});

export async function mockConnectedWallet(page: import('@playwright/test').Page) {
  await page.addInitScript((address) => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      getUserInfo: async () => ({ publicKey: address }),
      getPublicKey: async () => address,
      getAddress: async () => ({ address }),
      requestAccess: async () => {},
      signMessage: async () => new Uint8Array(64).fill(1),
      signTransaction: async () => 'mock-tx',
    };
  }, MOCK_ADDRESS);
}

export { expect } from '@playwright/test';
