import { expect, test } from '@playwright/test';

test('first-time Stellar tour can be completed and restarted', async ({ page }) => {
  await page.goto('/send');

  const dialog = page.getByRole('dialog', { name: 'This is Wraith' });
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet keys stay local' })).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a private recipient' })).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Set the XLM amount' })).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Send privately' })).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page.getByRole('dialog', { name: 'This is Wraith' })).toBeVisible();
});

test('tour can be dismissed with Escape and stays dismissed after refresh', async ({ page }) => {
  await page.goto('/send');

  await expect(page.getByRole('dialog', { name: 'This is Wraith' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
