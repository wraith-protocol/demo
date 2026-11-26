import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  expect,
  installSolanaWalletMock,
  MOCK_SOLANA_SIGNATURE,
  openVisualMobileMenu,
  RECIPIENT_SOLANA_META,
  selectVisualChain,
  test,
  visualMasks,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/send | solana-send-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/send');
    await selectVisualChain(page, 'solana');
    await beginVisualCase(page, testInfo, '/send', 'solana-send-disconnected', theme);
    await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
    await captureVisual(page, `solana-send-disconnected-${theme}`);
  });

  for (const mode of ['pending', 'success', 'failure'] as const) {
    test(`/send | solana-send-${mode} | ${theme}`, async ({ page }, testInfo) => {
      await installSolanaWalletMock(page, mode);
      await page.goto('/send');
      await selectVisualChain(page, 'solana');
      await beginVisualCase(page, testInfo, '/send', `solana-send-${mode}`, theme);
      await openVisualMobileMenu(page);
      await page.getByRole('button', { name: /Select Wallet|Connect Wallet/ }).click();
      await page.getByRole('button', { name: 'Phantom' }).click();
      const connectButton = page.getByRole('button', { name: 'Connect Wallet' });
      if ((await connectButton.count()) > 0 && (await connectButton.isVisible())) {
        await connectButton.click();
      }
      await expect(page.getByRole('button', { name: /GyGK/i })).toBeVisible();
      await closeVisualMobileMenu(page);

      await page.getByPlaceholder('st:sol:...').fill(RECIPIENT_SOLANA_META);
      await page.getByPlaceholder('0.0').fill('0.1');
      await page.getByRole('button', { name: 'Send Privately' }).click();

      if (mode === 'pending') {
        await expect(page.getByText('Pending', { exact: true })).toBeVisible();
      } else if (mode === 'success') {
        await expect(page.getByText('Transfer Complete', { exact: true })).toBeVisible();
        await expect(page.locator(`a[href*="${MOCK_SOLANA_SIGNATURE}"]`)).toBeVisible();
      } else {
        await expect(page.getByRole('alert')).toContainText('User rejected transaction signing');
      }

      await captureVisual(page, `solana-send-${mode}-${theme}`, [
        visualMasks.transactionHash(page),
      ]);
    });
  }
}
