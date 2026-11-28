import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  expect,
  installHorizenWalletMock,
  MOCK_EVM_TX_HASH,
  RECIPIENT_EVM_META,
  openVisualMobileMenu,
  test,
  visualMasks,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/send | horizen-send-disconnected | ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/send');
    await beginVisualCase(page, testInfo, '/send', 'horizen-send-disconnected', theme);
    await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
    await captureVisual(page, `horizen-send-disconnected-${theme}`);
  });

  for (const mode of ['pending', 'success', 'failure'] as const) {
    test(`/send | horizen-send-${mode} | ${theme}`, async ({ page }, testInfo) => {
      await installHorizenWalletMock(page, mode);
      await page.goto('/send');
      await beginVisualCase(page, testInfo, '/send', `horizen-send-${mode}`, theme);
      await openVisualMobileMenu(page);
      await page.getByRole('button', { name: 'Connect Wallet' }).click();
      await page.getByRole('button', { name: 'Rainbow' }).click();
      await expect(page.getByRole('button', { name: /0xf3.*2266/i })).toBeVisible();
      await closeVisualMobileMenu(page);

      await page.getByPlaceholder('st:eth:0x...').fill(RECIPIENT_EVM_META);
      await page.getByPlaceholder('0.0').fill('0.01');
      await page.getByRole('button', { name: 'Review transfer' }).click();
      await page.getByRole('button', { name: 'Confirm & send' }).click();

      if (mode === 'pending') {
        await expect(page.getByText('Confirming...', { exact: true })).toBeVisible();
      } else if (mode === 'success') {
        await expect(page.getByText('Transfer Complete', { exact: true })).toBeVisible();
        await expect(page.locator(`a[href*="${MOCK_EVM_TX_HASH}"]`)).toBeVisible();
      } else {
        await expect(page.getByRole('alert')).toContainText('User rejected transaction signing');
      }

      await captureVisual(page, `horizen-send-${mode}-${theme}`, [
        visualMasks.transactionHash(page),
      ]);
    });
  }
}
