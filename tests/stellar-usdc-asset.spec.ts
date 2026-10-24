import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const VALID_RECIPIENT =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

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

test.describe('Stellar USDC Asset Send', () => {
  test('shows asset selector and sends USDC to existing stealth address', async ({ page }) => {
    const recipient = VALID_RECIPIENT;
    const sender = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

    await injectFreighterMock(page);

    // Mock Horizon account with USDC balance
    await page.route('**/horizon-testnet.stellar.org/accounts/*', async (route) => {
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
    await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
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
    await page.getByLabel('Chain').selectOption('stellar');

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
    await expect(page.getByRole('button', { name: /Send (Privately|XLM)/ })).toBeEnabled();
  });

  test('shows trustline warning when recipient lacks USDC trustline', async ({ page }) => {
    const recipient = VALID_RECIPIENT;
    const sender = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

    await injectFreighterMock(page);

    // Mock sender account
    await page.route('**/horizon-testnet.stellar.org/accounts/*', async (route) => {
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
    await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
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
    await page.getByLabel('Chain').selectOption('stellar');

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
    await expect(page.getByRole('link', { name: 'trustline' })).toBeVisible();
  });
});
