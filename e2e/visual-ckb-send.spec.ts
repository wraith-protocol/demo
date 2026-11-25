import { test, expect, selectVisualChain } from './visual-fixtures';

test('CKB send: disconnected', async ({ page }) => {
  await page.goto('/send');
  await selectVisualChain(page, 'ckb');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
  await expect(page).toHaveScreenshot('ckb-send-disconnected.png');
});
