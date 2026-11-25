import { test, expect } from './visual-fixtures';

test('Horizen send: disconnected', async ({ page }) => {
  await page.goto('/send');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
  await expect(page).toHaveScreenshot('horizen-send-disconnected.png');
});
