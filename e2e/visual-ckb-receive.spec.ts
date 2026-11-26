import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  expect,
  installCkbWalletMock,
  openVisualMobileMenu,
  test,
  selectVisualChain,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/receive | ckb-receive-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/receive');
    await selectVisualChain(page, 'ckb');
    await beginVisualCase(page, testInfo, '/receive', 'ckb-receive-disconnected', theme);
    await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
    await captureVisual(page, `ckb-receive-disconnected-${theme}`);
  });

  test(`/receive | ckb-receive-payment-scan-empty | ${theme}`, async ({ page }, testInfo) => {
    await installCkbWalletMock(page);
    await page.goto('/receive');
    await selectVisualChain(page, 'ckb');
    await beginVisualCase(page, testInfo, '/receive', 'ckb-receive-payment-scan-empty', theme);
    await openVisualMobileMenu(page);
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: 'Wraith Visual Wallet' }).click();
    await expect(page.getByRole('button', { name: /ckt1qy/i })).toBeVisible();
    await closeVisualMobileMenu(page);
    await page.getByRole('button', { name: /derive stealth keys/i }).click();
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    await page.getByRole('button', { name: /scan for cells/i }).click();
    await expect(page.getByText(/0 cells found/i)).toBeVisible();
    await captureVisual(page, `ckb-receive-payment-scan-empty-${theme}`);
  });
}
