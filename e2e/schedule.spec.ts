import { test, expect } from '@playwright/test';

test.describe('Schedule UI', () => {
  test.beforeEach(async ({ page }) => {
    // Start with a clean store so the empty-state and create flow are deterministic.
    await page.goto('/schedule');
    await page.evaluate(() => {
      window.localStorage.removeItem('wraith-schedule-storage');
    });
    await page.goto('/schedule');
  });

  test('renders the page heading and the empty state', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /schedule/i, level: 1 })).toBeVisible();
    await expect(page.getByText('No active schedules')).toBeVisible();
  });

  test('creates, pauses, resumes a schedule and persists it across reload', async ({ page }) => {
    await page.getByLabel('Recipient').fill('st:xlm:test-recipient');
    await page.getByLabel('Amount').fill('5');
    await page.getByLabel('Interval').selectOption('daily');
    await page.getByRole('button', { name: 'Add schedule' }).click();

    const row = page.getByTestId('schedule-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('st:xlm:test-recipient');
    await expect(row).toContainText('5 XLM');
    await expect(row.getByTestId('status-active')).toBeVisible();

    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row.getByTestId('status-paused')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Resume' })).toBeVisible();

    await row.getByRole('button', { name: 'Resume' }).click();
    await expect(row.getByTestId('status-active')).toBeVisible();

    await page.reload();

    const persistedRow = page.getByTestId('schedule-row');
    await expect(persistedRow).toHaveCount(1);
    await expect(persistedRow).toContainText('st:xlm:test-recipient');
    await expect(persistedRow.getByTestId('status-active')).toBeVisible();
  });

  test('cancelling a schedule removes it from the active list', async ({ page }) => {
    await page.getByLabel('Recipient').fill('st:xlm:another-recipient');
    await page.getByLabel('Amount').fill('2');
    await page.getByRole('button', { name: 'Add schedule' }).click();

    const row = page.getByTestId('schedule-row');
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('No active schedules')).toBeVisible();
    await expect(page.getByTestId('schedule-row')).toHaveCount(0);
  });

  test('rejects an empty amount with an inline error', async ({ page }) => {
    await page.getByLabel('Recipient').fill('st:xlm:test-recipient');
    await page.getByRole('button', { name: 'Add schedule' }).click();

    await expect(page.getByRole('alert')).toContainText('Amount must be greater than zero.');
    await expect(page.getByTestId('schedule-row')).toHaveCount(0);
  });
});
