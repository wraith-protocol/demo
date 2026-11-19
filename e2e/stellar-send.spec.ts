import { test, expect } from './fixtures';

test.describe('Stellar Send - Visual Regression', () => {
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
    await chainSwitcher.selectOption('stellar');
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('stellar-send-not-connected.png');
  });

  test('form with recipient and amount', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:xlm:...');
    await recipientInput.fill('st:xlm:GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('100');
    await expect(page).toHaveScreenshot('stellar-send-form-filled.png');
  });

  test('success state with stealth address', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthResult = {
        stealthAddress: 'G1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABC',
        txHash: 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890',
      };
    });
    await expect(page).toHaveScreenshot('stellar-send-success.png');
  });

  test('mobile view - form filled', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:xlm:...');
    await recipientInput.fill('st:xlm:GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('100');
    await expect(page).toHaveScreenshot('stellar-send-mobile-form-filled.png');
  });
});
