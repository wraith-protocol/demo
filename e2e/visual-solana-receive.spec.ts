import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  expect,
  installSolanaWalletMock,
  openVisualMobileMenu,
  selectVisualChain,
  test,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/receive | solana-receive-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/receive');
    await selectVisualChain(page, 'solana');
    await beginVisualCase(page, testInfo, '/receive', 'solana-receive-disconnected', theme);
    await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
    await captureVisual(page, `solana-receive-disconnected-${theme}`);
  });

  test(`/receive | solana-receive-payment-scan-empty | ${theme}`, async ({ page }, testInfo) => {
    await installSolanaWalletMock(page, 'success');
    await page.goto('/receive');
    await selectVisualChain(page, 'solana');
    await beginVisualCase(page, testInfo, '/receive', 'solana-receive-payment-scan-empty', theme);
    await openVisualMobileMenu(page);
    await page.getByRole('button', { name: /Select Wallet|Connect Wallet/ }).click();
    await page.getByRole('button', { name: 'Phantom' }).click();
    const connectButton = page.getByRole('button', { name: 'Connect Wallet' });
    if ((await connectButton.count()) > 0 && (await connectButton.isVisible())) {
      await connectButton.click();
    }
    await expect(page.getByRole('button', { name: /GmaD/i })).toBeVisible();
    await closeVisualMobileMenu(page);
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    await page.getByRole('button', { name: 'Scan for Payments' }).click();
    await expect(page.getByText('No transfers found')).toBeVisible();
    await captureVisual(page, `solana-receive-payment-scan-empty-${theme}`);
  });
}
