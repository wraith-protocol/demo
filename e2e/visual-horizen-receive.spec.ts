import { test, expect } from './visual-fixtures';

test.describe('Horizen Receive - Visual Regression', () => {
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
  });

  test('not connected state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-receive-not-connected.png');
  });

  test('derive keys button', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-receive-derive-keys.png');
  });

  test('keys derived - meta address displayed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    });
    await expect(page).toHaveScreenshot('horizen-receive-meta-address.png');
  });

  test('registration pending', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'pending';
    });
    await expect(page).toHaveScreenshot('horizen-receive-registration-pending.png');
  });

  test('registration complete', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockRegistrationTx = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
    });
    await expect(page).toHaveScreenshot('horizen-receive-registration-complete.png');
  });

  test('scan for payments button', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
    });
    await expect(page).toHaveScreenshot('horizen-receive-scan-button.png');
  });

  test('scanning state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'scanning';
    });
    await expect(page).toHaveScreenshot('horizen-receive-scanning.png');
  });

  test('no transfers found', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [];
    });
    await expect(page).toHaveScreenshot('horizen-receive-no-transfers.png');
  });

  test('payment found with balance', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
    });
    await expect(page).toHaveScreenshot('horizen-receive-payment-found.png');
  });

  test('payment with withdraw form', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
    });
    const destInput = page.getByPlaceholder('Destination address (0x...)');
    await destInput.fill('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead');
    await expect(page).toHaveScreenshot('horizen-receive-withdraw-form.png');
  });

  test('payment with withdrawing state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
      (window as any).mockWithdrawState = 'withdrawing';
    });
    await expect(page).toHaveScreenshot('horizen-receive-withdrawing.png');
  });

  test('payment withdrawn successfully', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
      (window as any).mockWithdrawState = 'complete';
      (window as any).mockWithdrawTx = '0x2222333344445555666677778888999900001111aaaabbbbccccddddeeeeffff';
    });
    await expect(page).toHaveScreenshot('horizen-receive-withdrawn.png');
  });

  test('private key revealed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
    });
    const revealButton = page.getByText('Reveal private key');
    await revealButton.click();
    await expect(page).toHaveScreenshot('horizen-receive-key-revealed.png');
  });

  test('mobile view - not connected', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('horizen-receive-mobile-not-connected.png');
  });

  test('mobile view - payment found', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      (window as any).mockStealthKeys = {
        spendingPubKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        viewingPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        spendingKey: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        viewingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      };
      (window as any).mockMetaAddress = 'st:eth:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      (window as any).mockRegistrationState = 'complete';
      (window as any).mockScanState = 'complete';
      (window as any).mockMatchedAnnouncements = [
        {
          stealthAddress: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
          stealthPrivateKey: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          ephemeralPubKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          viewTag: '0x12',
          amount: '0.5',
        },
      ];
    });
    await expect(page).toHaveScreenshot('horizen-receive-mobile-payment-found.png');
  });
});
