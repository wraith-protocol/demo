import { test, expect, selectVisualChain } from './visual-fixtures';

test('Solana send: disconnected', async ({ page }) => {
  await page.goto('/send');
  await selectVisualChain(page, 'solana');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
  await expect(page).toHaveScreenshot('solana-send-disconnected.png');
});
