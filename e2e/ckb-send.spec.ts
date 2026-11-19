import { test, expect } from './fixtures';

test.describe('CKB Send - Visual Regression', () => {
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
    await chainSwitcher.selectOption('ckb');
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('ckb-send-not-connected.png');
  });

  test('form with recipient and amount', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:ckb:...');
    await recipientInput.fill('st:ckb:ckt1qyq2k5k5h5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('1000');
    await expect(page).toHaveScreenshot('ckb-send-form-filled.png');
  });

  test('stealth cell generated', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthResult = {
        stealthAddress: 'ckt1qyq2k5k5h5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k',
        lockArgs: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ephemeralPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewTag: '0x12',
      };
    });
    await expect(page).toHaveScreenshot('ckb-send-stealth-cell.png');
  });

  test('mobile view - form filled', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:ckb:...');
    await recipientInput.fill('st:ckb:ckt1qyq2k5k5h5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('1000');
    await expect(page).toHaveScreenshot('ckb-send-mobile-form-filled.png');
  });
});
