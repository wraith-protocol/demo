import { test, expect } from '@playwright/test';

const TOUR_KEY = 'wraith.tourCompleted';

test.describe('Stellar onboarding tour', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh — no tour completion flag
    await page.goto('/send');
    await page.evaluate((key) => localStorage.removeItem(key), TOUR_KEY);
  });

  test('auto-starts on first visit and completes happy path', async ({ page }) => {
    await page.goto('/send');

    // Tour popover should appear automatically
    const popover = page.locator('.driver-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Step 1: wallet connect target
    await expect(popover).toContainText('Welcome to Wraith');

    // Advance through all 5 steps
    for (let i = 0; i < 4; i++) {
      const nextBtn = page.locator('.driver-popover-next-btn');
      await expect(nextBtn).toBeVisible();
      await nextBtn.click();
    }

    // Step 5: send button — click Done
    await expect(popover).toContainText('Send Privately');
    const doneBtn = page.locator('.driver-popover-next-btn');
    await expect(doneBtn).toBeVisible();
    await doneBtn.click();

    // Popover should be gone
    await expect(popover).not.toBeVisible({ timeout: 3000 });

    // localStorage should be set
    const stored = await page.evaluate((key) => localStorage.getItem(key), TOUR_KEY);
    expect(stored).toBe('true');
  });

  test('does not auto-start on subsequent page loads after completion', async ({ page }) => {
    // Pre-set the flag
    await page.goto('/send');
    await page.evaluate((key) => localStorage.setItem(key, 'true'), TOUR_KEY);

    // Reload
    await page.reload();
    await page.waitForTimeout(600); // longer than the 300 ms delay in TourAutoStart

    const popover = page.locator('.driver-popover');
    await expect(popover).not.toBeVisible();
  });

  test('dismissing tour via close button persists completion flag', async ({ page }) => {
    await page.goto('/send');

    const popover = page.locator('.driver-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Click the close/skip button
    const closeBtn = page.locator('.driver-popover-close-btn');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(popover).not.toBeVisible({ timeout: 3000 });

    const stored = await page.evaluate((key) => localStorage.getItem(key), TOUR_KEY);
    expect(stored).toBe('true');
  });

  test('"Take the tour" footer button force-restarts the tour', async ({ page }) => {
    // Mark tour as completed
    await page.goto('/send');
    await page.evaluate((key) => localStorage.setItem(key, 'true'), TOUR_KEY);
    await page.reload();

    // Tour should NOT auto-start
    await page.waitForTimeout(600);
    const popover = page.locator('.driver-popover');
    await expect(popover).not.toBeVisible();

    // Click the footer restart button
    const restartBtn = page.locator('[data-testid="restart-tour"]');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // Tour should now be visible
    await expect(popover).toBeVisible({ timeout: 3000 });
    await expect(popover).toContainText('Welcome to Wraith');
  });
});
