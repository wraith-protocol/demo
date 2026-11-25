import { test, expect, openVisualMobileMenu, selectVisualChain } from './visual-fixtures';

test('Stellar receive: disconnected', async ({ page, freighter }) => {
  await freighter.mock({ isConnected: false });
  await page.goto('/receive');
  await selectVisualChain(page, 'stellar');
  await page.waitForLoadState('networkidle');
  await openVisualMobileMenu(page);
  await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
  await expect(page).toHaveScreenshot('stellar-receive-disconnected.png');
});
