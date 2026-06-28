import { test, expect } from '@playwright/test';

test.describe('Stellar Payment Link', () => {
  test.beforeEach(async ({ context }) => {
    // Mock Freighter API so the app thinks a wallet is installed and connected
    await context.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve({ isConnected: true }),
        getAddress: () => Promise.resolve({ address: 'GATTESTADDRESSYOURSFREIGHTER123456789' }),
        requestAccess: () => Promise.resolve(),
      };
      (window as any).freighterApi = (window as any).freighter; // Some versions use freighterApi
    });
  });

  test('should generate a link, pre-fill the send form, and disable inputs', async ({
    page,
    context,
  }) => {
    // 1. Go to Receive page
    await page.goto('/receive');
    await page.locator('select').selectOption('stellar');

    // 2. Open generated link in a new context
    const testUrl =
      '/pay?to=st:xlm:test_meta_address&amount=15.5&memo=TestMemo&exp=' +
      (Math.floor(Date.now() / 1000) + 3600);

    const newPage = await context.newPage();
    await newPage.goto(testUrl);

    // Switch to Stellar network
    await newPage.locator('select').selectOption('stellar');

    // Click Connect Freighter
    await newPage.click('text=Connect Freighter');

    // 3. Verify Send page pre-filled inputs
    const recipientInput = newPage.locator('input[placeholder="st:xlm:..."]');
    await expect(recipientInput).toHaveValue('st:xlm:test_meta_address');
    await expect(recipientInput).toBeDisabled();

    const amountInput = newPage.locator('input[placeholder="0.0"]');
    await expect(amountInput).toHaveValue('15.5');
    await expect(amountInput).toBeDisabled();

    const memoInput = newPage.locator('input[placeholder="e.g. Coffee"]');
    await expect(memoInput).toHaveValue('TestMemo');
    await expect(memoInput).toBeDisabled();
  });

  test('should show expiration error and disable submit for expired link', async ({ page }) => {
    const expiredExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const testUrl = `/pay?to=st:xlm:test_meta_address&amount=10&exp=${expiredExp}`;

    await page.goto(testUrl);

    // Switch to Stellar network
    await page.locator('select').selectOption('stellar');

    // Click Connect Freighter
    await page.click('text=Connect Freighter');

    // Check for error message
    const errorText = page.locator('text=This payment link has expired');
    await expect(errorText).toBeVisible();

    // The recipient and amount should still be pre-filled and disabled
    const recipientInput = page.locator('input[placeholder="st:xlm:..."]');
    await expect(recipientInput).toHaveValue('st:xlm:test_meta_address');
    await expect(recipientInput).toBeDisabled();

    // Verify submit button is disabled
    const submitButton = page.locator('button:has-text("Send Privately")');
    // Button might also say "Confirm in wallet..." but the text says "Send Privately" initially
    await expect(submitButton).toBeDisabled();
  });
});
