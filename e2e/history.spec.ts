import { test, expect } from '@playwright/test';
import { MOCK_STELLAR_ADDRESS, mockConnectedWallet, selectChain } from '../tests/fixtures';

const WALLET = MOCK_STELLAR_ADDRESS;

const ACTIVITY_KEY = 'wraith-activity-storage';

test.describe('Activity History', () => {
  test.beforeEach(async ({ page }) => {
    // `/history` renders the wallet-scoped history, so the wallet mock must be
    // installed before the app loads and the Stellar chain must be selected for
    // StellarWalletContext to connect (it only watches while on Stellar).
    await mockConnectedWallet(page, { address: WALLET });
    await page.addInitScript(
      ({ key, wallet }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            state: {
              entries: [
                {
                  id: 'tx1',
                  chain: 'stellar',
                  wallet,
                  kind: 'stealth-send',
                  direction: 'out',
                  status: 'confirmed',
                  amount: '10',
                  timestamp: Date.now() - 1000,
                },
                {
                  id: 'tx2',
                  chain: 'stellar',
                  wallet,
                  kind: 'withdrawal',
                  direction: 'out',
                  status: 'pending',
                  amount: '5',
                  timestamp: Date.now() - 2000,
                },
                {
                  id: 'tx3',
                  chain: 'stellar',
                  wallet,
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
      },
      { key: ACTIVITY_KEY, wallet: WALLET },
    );

    await page.goto('/history');
    await selectChain(page, 'stellar');
  });

  test('displays history entries and filters correctly', async ({ page }) => {
    await expect(page.getByText('Activity History')).toBeVisible();

    // Rows render as "<status> • <kind>". Anchor on the bullet: the type filter's
    // "Stealth Send" option would otherwise also match `getByText('stealth send')`.
    const stealthSendRow = page.getByText('• stealth send');
    const withdrawalRow = page.getByText('• withdrawal');
    const stealthReceiveRow = page.getByText('• stealth receive');

    // Check if all 3 items are shown initially
    await expect(stealthSendRow).toBeVisible();
    await expect(withdrawalRow).toBeVisible();
    await expect(stealthReceiveRow).toBeVisible();

    // Filter by type: withdrawal (scoped by id — the header holds other selects)
    await page.locator('#activity-kind').selectOption('withdrawal');
    await expect(withdrawalRow).toBeVisible();
    await expect(stealthSendRow).not.toBeVisible();

    // Filter by status: pending
    await page.locator('#activity-status').selectOption('pending');
    await expect(withdrawalRow).toBeVisible();

    // Clear history
    await page.getByRole('button', { name: 'Clear History' }).click();
    await expect(page.getByText('No activity recorded yet.')).toBeVisible();
  });
});
