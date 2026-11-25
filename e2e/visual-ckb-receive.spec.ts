import { test, expect, selectVisualChain } from './visual-fixtures';

test('CKB receive: disconnected', async ({ page }) => {
  await page.goto('/receive');
  await selectVisualChain(page, 'ckb');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
  await expect(page).toHaveScreenshot('ckb-receive-disconnected.png');
});
