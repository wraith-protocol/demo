import { test, expect } from './visual-fixtures';

test('Horizen receive: disconnected', async ({ page }) => {
  await page.goto('/receive');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible();
  await expect(page).toHaveScreenshot('horizen-receive-disconnected.png');
});
