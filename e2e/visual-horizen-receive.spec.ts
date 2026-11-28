import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  expect,
  installHorizenWalletMock,
  MOCK_EVM_SIGNING_ACCOUNT,
  openVisualMobileMenu,
  test,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/receive | horizen-receive-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/receive');
    await beginVisualCase(page, testInfo, '/receive', 'horizen-receive-disconnected', theme);
    await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
    await captureVisual(page, `horizen-receive-disconnected-${theme}`);
  });

  test(`/receive | horizen-receive-payment-scan-empty | ${theme}`, async ({ page }, testInfo) => {
    await installHorizenWalletMock(page, 'success', MOCK_EVM_SIGNING_ACCOUNT);
    await page.goto('/receive');
    await beginVisualCase(page, testInfo, '/receive', 'horizen-receive-payment-scan-empty', theme);
    await openVisualMobileMenu(page);
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: 'Rainbow' }).click();
    await expect(page.getByRole('button', { name: /0x7e.*5bdf/i })).toBeVisible();
    await closeVisualMobileMenu(page);
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    await page.getByRole('button', { name: 'Scan for Payments' }).click();
    await expect(page.getByText('No transfers found')).toBeVisible();
    await captureVisual(page, `horizen-receive-payment-scan-empty-${theme}`);
  });
}
