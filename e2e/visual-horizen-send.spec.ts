import { test, expect } from './visual-fixtures';

test.describe('Horizen Send - Visual Regression', () => {
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
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-send-not-connected.png');
  });

  test('connected empty form', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-send-empty-form.png');
  });

  test('form with recipient input', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    await expect(page).toHaveScreenshot('horizen-send-recipient-filled.png');
  });

  test('form with wraith name input', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill('alice.wraith');
    await expect(page).toHaveScreenshot('horizen-send-wraith-name.png');
  });

  test('form with amount input', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    await expect(page).toHaveScreenshot('horizen-send-amount-filled.png');
  });

  test('form with max amount', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const maxButton = page.getByText('Max');
    await maxButton.click();
    await expect(page).toHaveScreenshot('horizen-send-max-amount.png');
  });

  test('form with invalid input error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill('invalid-address');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('horizen-send-error.png');
  });

  test('pending transaction state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    await page.evaluate(() => {
      (window as any).mockTransactionState = 'pending';
    });
    await expect(page).toHaveScreenshot('horizen-send-pending.png');
  });

  test('success state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockTransactionState = 'success';
      (window as any).mockStealthResult = {
        stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        txHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      };
    });
    await expect(page).toHaveScreenshot('horizen-send-success.png');
  });

  test('mobile view - not connected', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-send-mobile-not-connected.png');
  });

  test('mobile view - form filled', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    await expect(page).toHaveScreenshot('horizen-send-mobile-form-filled.png');
  });

  test('tablet view - not connected', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-send-tablet-not-connected.png');
  });
});
