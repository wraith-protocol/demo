import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';

async function injectFreighterMock(page: Page) {
  return page.addInitScript(() => {
    const address = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      requestAccess: () => Promise.resolve({ address }),
      getAddress: () => Promise.resolve({ address }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
      signMessage: (message: string) => Promise.resolve({ signedMessage: message }),
    };
  });
}

test.describe('Stellar send simulation', () => {
  test('disables send and shows decoded Soroban error when simulation fails', async ({ page }) => {
    const recipient = encodeStealthMetaAddress(new Uint8Array(32).fill(7), new Uint8Array(32).fill(9));
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
          error: {
            code: -32603,
            message: 'Error(Contract, #7)',
          },
        }),
      });
    });

    await page.goto('/send');
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) {
      await stellarTab.click();
    }

    await page.getByLabel('Recipient Meta-Address').fill(recipient);
    await page.getByLabel('Amount').fill('1');

    await expect(page.getByText('Soroban contract error #7')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send Privately' })).toBeDisabled();
  });
});
