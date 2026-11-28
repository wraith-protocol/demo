import {
  beginVisualCase,
  captureVisual,
  closeVisualMobileMenu,
  connectVisualWallet,
  MOCK_WALLET,
  test,
  expect,
  openVisualMobileMenu,
  selectVisualChain,
} from './visual-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`/receive | stellar-receive-disconnected | ${theme}`, async ({
    page,
    freighter,
  }, testInfo) => {
    await freighter.mock({ isConnected: false });
    await page.goto('/receive');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/receive', 'stellar-receive-disconnected', theme);
    await openVisualMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
    await closeVisualMobileMenu(page);
    await captureVisual(page, `stellar-receive-disconnected-${theme}`);
  });

  test(`/receive | stellar-receive-derived-keys | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({});
    await page.goto('/receive');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/receive', 'stellar-receive-derived-keys', theme);
    await connectVisualWallet(page, 'Connect Freighter');
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    await expect(page.locator('code').first()).toContainText('st:xlm:');
    await captureVisual(page, `stellar-receive-derived-keys-${theme}`);
  });

  test(`/receive | stellar-receive-payment-found | ${theme}`, async ({
    page,
    freighter,
    horizon,
  }, testInfo) => {
    await freighter.mock({ isConnected: true, address: MOCK_WALLET });
    await horizon.mock({
      accountBalance: '100',
      sorobanEvents: [
        {
          schemeId: 1,
          stealthAddress: 'GAL77LMANDOA32MTLU3GG3Z22G2543PDIE5REOEOIU5QL4VEYHJ5WKON',
          caller: MOCK_WALLET,
          ephemeralPubKey: new Uint8Array(32),
          viewTag: 42,
        },
      ],
    });
    await page.goto('/receive');
    await selectVisualChain(page, 'stellar');
    await beginVisualCase(page, testInfo, '/receive', 'stellar-receive-payment-found', theme);
    await connectVisualWallet(page, 'Connect Freighter');
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    await page.getByRole('button', { name: 'Scan for Payments' }).click();
    await expect(page.getByText('1 transfer found')).toBeVisible();
    await expect(page.getByText('100 XLM')).toBeVisible();
    await captureVisual(page, `stellar-receive-payment-found-${theme}`);
  });
}
