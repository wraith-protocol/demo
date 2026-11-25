import { test, expect, MOCK_WALLET, MOCK_TX_HASH, RECIPIENT_META } from './visual-fixtures';

test.describe('Stellar Send - visual regression', () => {
  test('send: disconnected', async ({ page, freighter }) => {
    await freighter.mock({ isConnected: false });
    await page.goto('/send');
    await page.locator('select:not(#locale-switcher)').selectOption('stellar');
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
    await expect(page).toHaveScreenshot('stellar-send-disconnected.png');
  });

  test('send: form filled', async ({ page, freighter, horizon }) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({ accountBalance: '1000' });
    await page.goto('/send');
    await page.locator('select:not(#locale-switcher)').selectOption('stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();
    await page.getByPlaceholder('st:xlm:...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('50');
    await expect(page).toHaveScreenshot('stellar-send-form-filled.png');
  });

  test('send: success', async ({ page, freighter, horizon }) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({
      accountExists: true,
      accountBalance: '1000',
      txSuccess: true,
      txHash: MOCK_TX_HASH,
    });
    await page.goto('/send');
    await page.locator('select:not(#locale-switcher)').selectOption('stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();
    await page.getByPlaceholder('st:xlm:...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('50');
    await page.getByRole('button', { name: 'Send Privately' }).click();

    // Real success state, reached through the app's own code path.
    await expect(page.getByText('Transfer Complete')).toBeVisible();
    await expect(page.getByText(MOCK_TX_HASH)).toBeVisible();
    await expect(page).toHaveScreenshot('stellar-send-success.png');
  });

  test('send: failure', async ({ page, freighter, horizon }) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({ accountExists: true, txSuccess: false, txErrorCode: 'tx_failed' });
    await page.goto('/send');
    await page.locator('select:not(#locale-switcher)').selectOption('stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();
    await page.getByPlaceholder('st:xlm:...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('50');
    await page.getByRole('button', { name: 'Send Privately' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveScreenshot('stellar-send-failure.png');
  });
});
