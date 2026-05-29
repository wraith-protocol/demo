import { test, expect } from '@playwright/test';

test.describe('StellarSend validations', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.freighter = true;
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
        const response: Record<string, unknown> = {
          source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
          messagedId: data.messageId,
        };

        if (data.type === 'REQUEST_PUBLIC_KEY' || data.type === 'REQUEST_ACCESS') {
          response.publicKey = 'GBRPYHIL2CI3A5PIJIFYV55ZBPVMLW7NQLDBZZ3RBIEZH5YMDQOOYADG';
        }

        if (data.type === 'REQUEST_CONNECTION_STATUS') {
          response.isConnected = true;
        }

        window.postMessage(response, window.location.origin);
      });
    });

    await page.goto('/send');
    await page.locator('select').selectOption('stellar');
    await page.waitForSelector('#recipient-input', { timeout: 10000 });
  });

  test('Invalid meta-address shows error message', async ({ page }) => {
    await page.fill('#recipient-input', 'invalid-address');
    // blur to allow validation to run
    await page.locator('#amount-input').focus();
    await expect(page.locator('#recipient-error')).toBeVisible();
  });

  test('Invalid amount (negative, wrong decimals) shows error', async ({ page }) => {
    // negative
    await page.fill('#amount-input', '-1');
    await page.locator('#recipient-input').focus();
    await expect(page.locator('#amount-error')).toBeVisible();

    // too many decimals
    await page.fill('#amount-input', '1.12345678');
    await page.locator('#recipient-input').focus();
    await expect(page.locator('#amount-error')).toBeVisible();
  });

  test('Insufficient balance shows error with correct XLM values', async ({ page }) => {
    // Intercept Horizon ledger and accounts to simulate low balance
    await page.route('**/ledgers?**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          _embedded: { records: [{ base_reserve_in_stroops: '5000000' }] },
        }),
      });
    });

    await page.route('**/accounts/**', (route) => {
      // return account with 1 XLM
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balances: [{ asset_type: 'native', balance: '1.0' }],
          sequence: '1',
        }),
      });
    });

    // valid-looking recipient (base32-ish)
    await page.fill('#recipient-input', 'st:xlm:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await page.fill('#amount-input', '1.0');
    // wait for debounce + balance check
    await page.waitForTimeout(600);
    await expect(page.locator('#balance-error')).toBeVisible();
    await expect(page.locator('#balance-error')).toHaveText(/Insufficient balance/);
  });

  test('Submit button is disabled when validation fails', async ({ page }) => {
    await page.fill('#recipient-input', 'invalid');
    await page.fill('#amount-input', '-5');
    await page.waitForTimeout(200);
    const btn = page.locator('button', { hasText: 'Send Privately' });
    await expect(btn).toBeDisabled();
  });
});
