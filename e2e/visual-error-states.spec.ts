import { test, expect } from './visual-fixtures';

test.describe('Error States - Visual Regression', () => {
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

  test('invalid meta-address error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill('invalid-address');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-invalid-meta-address.png');
  });

  test('name not found error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill('nonexistent.wraith');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-name-not-found.png');
  });

  test('insufficient balance error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockBalance = '0';
    });
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('10');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-insufficient-balance.png');
  });

  test('transaction failed error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockTransactionError = 'Transaction reverted';
    });
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill(
      'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-transaction-failed.png');
  });

  test('wallet connection error', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockWalletError = 'Wallet not installed';
    });
    const connectButton = page.getByText('Connect Wallet');
    await connectButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-wallet-connection.png');
  });

  test('mobile - invalid meta-address error', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    const recipientInput = page.getByPlaceholder('st:eth:0x... or name.wraith');
    await recipientInput.fill('invalid-address');
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('0.5');
    const sendButton = page.getByText('Send Privately');
    await sendButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('error-mobile-invalid-meta-address.png');
  });
});
