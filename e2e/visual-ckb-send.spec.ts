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
  test(`/send | ckb-send-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/send');
    await selectVisualChain(page, 'ckb');
    await beginVisualCase(page, testInfo, '/send', 'ckb-send-disconnected', theme);
    await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
    await captureVisual(page, `ckb-send-disconnected-${theme}`);
  });

  test(`/send | ckb-send-connected-form | ${theme}`, async ({ page }, testInfo) => {
    await installCkbWalletMock(page);
    await page.goto('/send');
    await selectVisualChain(page, 'ckb');
    await beginVisualCase(page, testInfo, '/send', 'ckb-send-connected-form', theme);
    await openVisualMobileMenu(page);
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: 'Wraith Visual Wallet' }).click();
    await expect(page.getByRole('button', { name: /ckt1qy/i })).toBeVisible();
    await closeVisualMobileMenu(page);
    await expect(page.getByPlaceholder('st:ckb:...')).toBeVisible();
    await expect(page.getByRole('button', { name: /send privately/i })).toBeVisible();
    await captureVisual(page, `ckb-send-connected-form-${theme}`);
  });
}
