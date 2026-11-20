import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NOATFQRAHX4JHPX';

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

test.describe('Stellar USDC Asset Send', () => {
  test('shows asset selector and sends USDC to existing stealth address', async ({ page }) => {
    const recipient = encodeStealthMetaAddress(
      new Uint8Array(32).fill(7),
      new Uint8Array(32).fill(9),
    );
    const sender = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

    await injectFreighterMock(page);

    // Mock Horizon account with USDC balance
    await page.route('https://horizon-testnet.stellar.org/accounts/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/accounts/${sender}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sequence: '123',
            balances: [
              { asset_type: 'native', balance: '1000' },
              {
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                asset_issuer: USDC_ISSUER,
                balance: '500',
              },
            ],
          }),
        });
        return;
      }
      // Stealth address exists and has USDC trustline
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sequence: '456',
          balances: [
            { asset_type: 'native', balance: '10' },
            {
              asset_type: 'credit_alphanum4',
              asset_code: 'USDC',
              asset_issuer: USDC_ISSUER,
              balance: '100',
            },
          ],
        }),
      });
    });

    // Mock Soroban RPC for simulation
    await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            results: [{ auth: [], retval: { type: 'void' } }],
            minResourceFee: '100',
            transactionData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        }),
      });
    });

    await page.goto('/send');
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) {
      await stellarTab.click();
    }

    // Select USDC asset
    await page.selectOption('#stellar-asset', 'USDC');

    // Enter recipient
    await page.getByLabel('Recipient Meta-Address').fill(recipient);

    // Enter amount
    await page.getByLabel('Amount').fill('50');

    // Verify balance shows USDC
    await expect(page.getByText(/500 USDC/)).toBeVisible();

    // Verify send button shows USDC
    await expect(page.getByRole('button', { name: 'Send USDC' })).toBeEnabled();

    // Switch back to XLM
    await page.selectOption('#stellar-asset', 'XLM');
    await expect(page.getByRole('button', { name: 'Send XLM' })).toBeEnabled();
  });

  test('shows trustline warning when recipient lacks USDC trustline', async ({ page }) => {
    const recipient = encodeStealthMetaAddress(
      new Uint8Array(32).fill(7),
      new Uint8Array(32).fill(9),
    );
    const sender = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

    await injectFreighterMock(page);

    // Mock sender account
    await page.route('https://horizon-testnet.stellar.org/accounts/*', async (route) => {
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
      // Stealth address exists but NO USDC trustline
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sequence: '456',
          balances: [{ asset_type: 'native', balance: '10' }],
        }),
      });
    });

    // Mock Soroban RPC
    await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            results: [{ auth: [], retval: { type: 'void' } }],
            minResourceFee: '100',
            transactionData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        }),
      });
    });

    await page.goto('/send');
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) {
      await stellarTab.click();
    }

    // Select USDC asset
    await page.selectOption('#stellar-asset', 'USDC');

    // Enter recipient
    await page.getByLabel('Recipient Meta-Address').fill(recipient);

    // Enter amount
    await page.getByLabel('Amount').fill('10');

    // Wait for trustline check
    await page.waitForTimeout(1500);

    // Verify trustline warning is shown
    await expect(page.getByText(/lacks.*USDC trustline/i)).toBeVisible();
    await expect(page.getByText(/trustline/i)).toBeVisible();
  });
});
