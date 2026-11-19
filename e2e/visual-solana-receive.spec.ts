import { test, expect } from './visual-fixtures';

test.describe('Solana Receive - Visual Regression', () => {
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
    await chainSwitcher.selectOption('solana');
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('solana-receive-not-connected.png');
  });

  test('keys derived - meta address displayed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        viewingPubKey: '5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      };
      (window as any).mockMetaAddress = 'st:sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    });
    await expect(page).toHaveScreenshot('solana-receive-meta-address.png');
  });

  test('payment found with balance', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        viewingPubKey: '5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      };
      (window as any).mockMetaAddress = 'st:sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '3xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          stealthPrivateKey: '4sKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          ephemeralPubKey: '6xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          viewTag: 'ab',
          amount: '2.5',
        },
      ];
    });
    await expect(page).toHaveScreenshot('solana-receive-payment-found.png');
  });

  test('mobile view - payment found', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        viewingPubKey: '5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      };
      (window as any).mockMetaAddress = 'st:sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU5yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '3xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          stealthPrivateKey: '4sKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          ephemeralPubKey: '6xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          viewTag: 'ab',
          amount: '2.5',
        },
      ];
    });
    await expect(page).toHaveScreenshot('solana-receive-mobile-payment-found.png');
  });
});
