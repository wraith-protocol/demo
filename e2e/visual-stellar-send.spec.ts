import {
  test,
  expect,
  MOCK_WALLET,
  MOCK_TX_HASH,
  RECIPIENT_META,
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  connectVisualWallet,
  openVisualMobileMenu,
  selectVisualChain,
  visualMasks,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/send | stellar-send-disconnected | ${theme}`, async ({ page, freighter }, testInfo) => {
    await freighter.mock({ isConnected: false });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-send-disconnected', theme);
    await expect(
      page.getByText('Connect your Freighter wallet to send stealth payments on Stellar.'),
    ).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading page' })).toBeHidden();
    await openVisualMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
    await closeVisualMobileMenu(page);
    await captureVisual(page, `stellar-send-disconnected-${theme}`);
  });

  test(`/send | stellar-send-form-filled | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({ accountBalance: '1000' });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-send-form-filled', theme);
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
    await captureVisual(page, `stellar-send-form-filled-${theme}`);
  });

  test(`/send | stellar-send-pending | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_WALLET,
      shouldPendSignTx: true,
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-send-pending', theme);
    await connectVisualWallet(page, 'Connect Freighter');
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/accounts/${MOCK_WALLET}`) && response.status() === 200,
    );
    await page.getByPlaceholder('0.0').fill('50');
    await balanceResponse;
    await page.getByRole('button', { name: 'Send Privately' }).click();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await captureVisual(page, `stellar-send-pending-${theme}`);
  });

  test(`/send | stellar-send-failure | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_WALLET,
      shouldFailSignTx: true,
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-send-failure', theme);
    await connectVisualWallet(page, 'Connect Freighter');
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/accounts/${MOCK_WALLET}`) && response.status() === 200,
    );
    await page.getByPlaceholder('0.0').fill('50');
    await balanceResponse;
    await page.getByRole('button', { name: 'Send Privately' }).click();
    await expect(page.getByRole('alert')).toHaveText('User rejected transaction signing');
    await captureVisual(page, `stellar-send-failure-${theme}`);
  });

  test(`/send | stellar-send-success | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({
      accountExists: true,
      accountBalance: '1000',
      txSuccess: true,
      txHash: MOCK_TX_HASH,
    });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-send-success', theme);
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
    await captureVisual(page, `stellar-send-success-${theme}`, [visualMasks.transactionHash(page)]);
  });

  test(`/send | stellar-wrong-network | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_WALLET,
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    await horizon.mock({ accountBalance: '1000' });
    await page.goto('/send');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/send', 'stellar-wrong-network', theme);
    await connectVisualWallet(page, 'Connect Freighter');
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/accounts/${MOCK_WALLET}`) && response.status() === 200,
    );
    await page.getByPlaceholder('0.0').fill('50');
    await balanceResponse;
    await page.getByRole('button', { name: 'Send Privately' }).click();
    await expect(page.getByRole('heading', { name: 'Network Mismatch' })).toBeVisible();
    await captureVisual(page, `stellar-wrong-network-${theme}`);
  });
}
