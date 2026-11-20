import { test, expect } from './visual-fixtures';

test.describe('Solana Send - Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/send');
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
    await expect(page).toHaveScreenshot('solana-send-not-connected.png');
  });

  test('form with recipient and amount', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:sol:...');
    await recipientInput.fill('st:sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('1.5');
    await expect(page).toHaveScreenshot('solana-send-form-filled.png');
  });

  test('success state with stealth address', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthResult = {
        stealthAddress: '5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        txSignature: '3abc123def4567890abc123def4567890abc123def4567890abc123def4567890',
      };
    });
    await expect(page).toHaveScreenshot('solana-send-success.png');
  });

  test('mobile view - form filled', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:sol:...');
    await recipientInput.fill('st:sol:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('1.5');
    await expect(page).toHaveScreenshot('solana-send-mobile-form-filled.png');
  });
});
