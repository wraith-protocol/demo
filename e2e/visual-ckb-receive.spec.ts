import { test, expect } from './visual-fixtures';

test.describe('CKB Receive - Visual Regression', () => {
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
    await chainSwitcher.selectOption('ckb');
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('ckb-receive-not-connected.png');
  });

  test('keys derived - meta address displayed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };
      (window as any).mockMetaAddress =
        'st:ckb:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    });
    await expect(page).toHaveScreenshot('ckb-receive-meta-address.png');
  });

  test('stealth cell found with balance', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };
      (window as any).mockMetaAddress =
        'st:ckb:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockMatchedCells = [
        {
          stealthAddress: 'ckt1qyq2k5k5h5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          lockArgs: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '5000',
        },
      ];
    });
    await expect(page).toHaveScreenshot('ckb-receive-cell-found.png');
  });

  test('mobile view - cell found', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };
      (window as any).mockMetaAddress =
        'st:ckb:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockMatchedCells = [
        {
          stealthAddress: 'ckt1qyq2k5k5h5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          lockArgs: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '5000',
        },
      ];
    });
    await expect(page).toHaveScreenshot('ckb-receive-mobile-cell-found.png');
  });
});
