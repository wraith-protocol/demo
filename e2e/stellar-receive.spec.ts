import { test, expect } from './fixtures';

test.describe('Stellar Receive - Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/receive');
    await page.evaluate(() => {
      window.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const chainSwitcher = page.getByRole('combobox');
    await chainSwitcher.selectOption('stellar');
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('stellar-receive-not-connected.png');
  });

  test('keys derived - meta address displayed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        viewingPubKey: 'GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321',
      };
      (window as any).mockMetaAddress = 'st:xlm:GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321';
    });
    await expect(page).toHaveScreenshot('stellar-receive-meta-address.png');
  });

  test('payment found with balance', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        viewingPubKey: 'GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321',
      };
      (window as any).mockMetaAddress = 'st:xlm:GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: 'G1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABC',
          stealthPrivateKey: 'S1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
          viewTag: '12',
          amount: '50',
        },
      ];
    });
    await expect(page).toHaveScreenshot('stellar-receive-payment-found.png');
  });

  test('mobile view - payment found', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        viewingPubKey: 'GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321',
      };
      (window as any).mockMetaAddress = 'st:xlm:GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890GFEDCBA0987654321FEDCBA0987654321FEDCBA0987654321FEDCBA0987654321';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: 'G1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABC',
          stealthPrivateKey: 'S1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
          viewTag: '12',
          amount: '50',
        },
      ];
    });
    await expect(page).toHaveScreenshot('stellar-receive-mobile-payment-found.png');
  });
});
