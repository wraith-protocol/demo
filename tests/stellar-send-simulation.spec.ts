import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';

async function injectFreighterMock(page: Page) {
  return page.addInitScript(() => {
    const address = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';
    const mock = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      isAllowed: () => Promise.resolve({ isAllowed: true }),
      requestAccess: () => Promise.resolve({ address }),
      getAddress: () => Promise.resolve({ address }),
      getNetworkDetails: () =>
        Promise.resolve({
          networkPassphrase: 'Test SDF Network ; September 2015',
          network: 'TESTNET',
          networkUrl: 'https://horizon-testnet.stellar.org',
        }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
      signMessage: (message: string) => Promise.resolve({ signedMessage: message }),
    };
    (window as any).freighterMock = mock;
    (window as any).freighter = mock;
  });
}

test.describe('Stellar send simulation', () => {
  test('disables send and shows decoded Soroban error when simulation fails', async ({ page }) => {
    const recipient =
      'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';
    const sender = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

    await injectFreighterMock(page);

    await page.route('**/horizon-testnet.stellar.org/accounts/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/accounts/${sender}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sequence: '123',
            balances: [{ asset_type: 'native', balance: '1000' }],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            error: 'Error(Contract, #7)',
            latestLedger: 12345,
          },
        }),
      });
    });

    await page.goto('/send');
    await page.getByLabel('Chain').selectOption('stellar');

    await page.getByLabel('Recipient Meta-Address').fill(recipient);
    await page.getByLabel('Amount').fill('1');

    await expect(page.getByText('Soroban contract error #7')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send Privately' })).toBeDisabled();
  });
});
