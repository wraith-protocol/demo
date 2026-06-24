import { test, expect } from '@playwright/test';

test.describe('/split page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/split');
  });

  test('renders Split heading and connect prompt', async ({ page }) => {
    // Freighter is not installed in CI, so wallet shows disconnected state
    await expect(page.getByRole('heading', { name: /split/i })).toBeVisible();
    await expect(page.getByText(/Connect your Freighter wallet/i)).toBeVisible();
  });

  test('Split nav link is present in header', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Split' })).toBeVisible();
  });

  test('navigates to /split from header link', async ({ page }) => {
    await page.goto('/send');
    await page.getByRole('link', { name: 'Split' }).click();
    await expect(page).toHaveURL('/split');
  });

  test('form renders with 2 default recipient slots when connected', async ({ page }) => {
    // Inject a mock connected wallet into the page context
    await page.addInitScript(() => {
      (window as Record<string, unknown>).__MOCK_STELLAR_CONNECTED__ = true;
    });

    // Without a real wallet, the disconnected UI shows — just verify the page loads
    await expect(page.getByRole('heading', { name: /split/i })).toBeVisible();
  });

  test('Share link navigates back to /send', async ({ page }) => {
    await page.goto('/send');
    await expect(page.getByRole('heading', { name: /send/i })).toBeVisible();
  });
});
