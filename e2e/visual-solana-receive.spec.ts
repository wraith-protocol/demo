import { test, expect, selectVisualChain } from './visual-fixtures';

test('Solana receive: disconnected', async ({ page }) => {
  await page.goto('/receive');
  await selectVisualChain(page, 'solana');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
  await expect(page).toHaveScreenshot('solana-receive-disconnected.png');
});
