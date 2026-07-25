import { test, expect } from '@playwright/test';

test.describe('Activity History', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to history page
    await page.goto('/history');

    // Simulate connecting a wallet and populating localStorage with mock data
    await page.evaluate(() => {
      // Mock wallet connection state if necessary
      window.localStorage.setItem('wraith-wallet', JSON.stringify({ address: 'GDTESTWALLET123' }));

      // Mock history store
      window.localStorage.setItem(
        'wraith-activity-storage',
        JSON.stringify({
          state: {
            entries: [
              {
                id: 'tx1',
                chain: 'stellar',
                wallet: 'GDTESTWALLET123',
                kind: 'stealth-send',
                direction: 'out',
                status: 'confirmed',
                amount: '10',
                timestamp: Date.now() - 1000,
              },
              {
                id: 'tx2',
                chain: 'stellar',
                wallet: 'GDTESTWALLET123',
                kind: 'withdrawal',
                direction: 'out',
                status: 'pending',
                amount: '5',
                timestamp: Date.now() - 2000,
              },
              {
                id: 'tx3',
                chain: 'stellar',
                wallet: 'GDTESTWALLET123',
                kind: 'stealth-receive',
                direction: 'in',
                status: 'confirmed',
                timestamp: Date.now() - 3000,
              },
            ],
          },
          version: 0,
        }),
      );
    });

    // Reload to apply localStorage
    await page.reload();
  });

  test('displays history entries and filters correctly', async ({ page }) => {
    // Wait for the history page to load
    await expect(page.getByText('Activity History')).toBeVisible();

    // Check if all 3 items are shown initially
    await expect(page.getByText('stealth send')).toBeVisible();
    await expect(page.getByText('withdrawal')).toBeVisible();
    await expect(page.getByText('stealth receive')).toBeVisible();

    // Filter by type: withdrawal
    await page.locator('select').first().selectOption('withdrawal');
    await expect(page.getByText('withdrawal')).toBeVisible();
    await expect(page.getByText('stealth send')).not.toBeVisible();

    // Filter by status: pending
    await page.locator('select').nth(1).selectOption('pending');
    await expect(page.getByText('withdrawal')).toBeVisible();

    // Clear history
    await page.getByRole('button', { name: 'Clear History' }).click();
    await expect(page.getByText('No activity recorded yet.')).toBeVisible();
  });
});
