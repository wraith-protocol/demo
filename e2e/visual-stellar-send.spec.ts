import {
  test,
  expect,
  MOCK_WALLET,
  MOCK_TX_HASH,
  RECIPIENT_META,
  connectVisualWallet,
  openVisualMobileMenu,
  selectVisualChain,
} from './visual-fixtures';

test.describe('Stellar Send - visual regression', () => {
  test('send: disconnected', async ({ page, freighter }) => {
    await freighter.mock({ isConnected: false });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await page.waitForLoadState('networkidle');
    await openVisualMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
    await expect(page).toHaveScreenshot('stellar-send-disconnected.png');
  });

  test('send: form filled', async ({ page, freighter, horizon }) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({ accountBalance: '1000' });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await page.waitForLoadState('networkidle');
    await connectVisualWallet(page, 'Connect Freighter');
    await page.getByPlaceholder('st:xlm:...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/accounts/${MOCK_WALLET}`) && response.status() === 200,
    );
    await page.getByPlaceholder('0.0').fill('50');
    await balanceResponse;
    await expect(page.getByRole('button', { name: 'Send Privately' })).toBeEnabled();
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
    await selectVisualChain(page, 'stellar');
    await page.waitForLoadState('networkidle');
    await connectVisualWallet(page, 'Connect Freighter');
    await page.getByPlaceholder('st:xlm:...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/accounts/${MOCK_WALLET}`) && response.status() === 200,
    );
    await page.getByPlaceholder('0.0').fill('50');
    await balanceResponse;
    const sendButton = page.getByRole('button', { name: 'Send Privately' });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // Real success state, reached through the app's own code path.
    await expect(page.getByText('Transfer Complete')).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: `View Stellar transaction ${MOCK_TX_HASH} on Stellar Expert`,
      }),
    ).toHaveAttribute('href', expect.stringContaining(MOCK_TX_HASH));
    await expect(page).toHaveScreenshot('stellar-send-success.png');
  });
});
