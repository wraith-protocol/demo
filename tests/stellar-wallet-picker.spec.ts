/**
 * tests/stellar-wallet-picker.spec.ts
 *
 * Playwright end-to-end tests for the Stellar wallet picker.
 *
 * Tests:
 *   - Picker opens when "Connect wallet" is clicked
 *   - All four wallet options are displayed
 *   - Albedo is always shown as "Installed" (no extension required)
 *   - Freighter shows correct status badge based on extension presence
 *   - Selecting Albedo triggers connect flow (mocked via page.addInitScript)
 *   - Successful connect closes the picker and shows the connected button
 *   - Disconnect clears the session
 *   - Persisted wallet restores on reload
 */

import { test, expect, Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject a mock Albedo intent into the page so the connect popup
 * is handled programmatically without a real browser tab.
 */
async function injectAlbedoMock(page: Page, publicKey = 'GALBEDOTEST1234567890ABCDEF') {
  await page.addInitScript((pk) => {
    // Override the @albedo-link/intent module resolution by patching
    // window before the app bundle loads.
    (window as unknown as Record<string, unknown>).__MOCK_ALBEDO_PK__ = pk;
  }, publicKey);
}

/**
 * Inject a mock Freighter extension into the page.
 */
async function injectFreighterMock(page: Page, publicKey = 'GFREIGHTERTEST1234567890') {
  await page.addInitScript((pk) => {
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      requestAccess: () => Promise.resolve({ address: pk }),
      getNetwork: () => Promise.resolve({ network: 'TESTNET' }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
    };
  }, publicKey);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('StellarWalletPicker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Stellar chain (tab or route depending on app layout)
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) {
      await stellarTab.click();
    }
  });

  test('connect button is visible when no wallet is connected', async ({ page }) => {
    const btn = page.getByTestId('wallet-connect-button');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Connect wallet');
  });

  test('picker modal opens when connect button is clicked', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Connect Stellar wallet')).toBeVisible();
  });

  test('all four wallet options are displayed', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();

    for (const id of ['freighter', 'albedo', 'xbull', 'lobstr']) {
      await expect(page.getByTestId(`wallet-option-${id}`)).toBeVisible();
    }
  });

  test('Albedo is always shown as Installed', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();

    const albedoOption = page.getByTestId('wallet-option-albedo');
    await expect(albedoOption).toContainText('Installed');
  });

  test('wallet without extension shows "Not detected" with install link', async ({ page }) => {
    // No extension mocks injected — xBull and LOBSTR should show as not detected
    await page.getByTestId('wallet-connect-button').click();

    // Wait for detection to complete (detecting… → status)
    await page.waitForFunction(() => !document.body.textContent?.includes('Detecting…'));

    const xbullOption = page.getByTestId('wallet-option-xbull');
    await expect(xbullOption).toContainText('Not detected');
    await expect(xbullOption.getByRole('link')).toHaveAttribute('href', 'https://xbull.app');
  });

  test('picker closes when X button is clicked', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Albedo connect path', () => {
  test.beforeEach(async ({ page }) => {
    await injectAlbedoMock(page);
    await page.goto('/');
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) await stellarTab.click();
  });

  test('selecting Albedo connects and shows connected button', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await page.getByTestId('wallet-option-albedo').click();

    // Picker should close and connected button should appear
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 5000 });
  });

  test('connected button shows truncated public key', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await page.getByTestId('wallet-option-albedo').click();

    const btn = page.getByTestId('wallet-connected-button');
    await expect(btn).toBeVisible({ timeout: 5000 });
    // Should show truncated form GALBE…CDEF
    await expect(btn).toContainText('GALBE');
  });

  test('disconnect clears session and restores connect button', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await page.getByTestId('wallet-option-albedo').click();
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('wallet-connected-button').click();
    await page.getByTestId('wallet-disconnect-button').click();

    await expect(page.getByTestId('wallet-connect-button')).toBeVisible({ timeout: 3000 });
  });

  test('connected wallet persists across reload', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await page.getByTestId('wallet-option-albedo').click();
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 5000 });

    await page.reload();
    // Auto-reconnect from localStorage should restore the connected state
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Freighter connect path', () => {
  test.beforeEach(async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto('/');
    const stellarTab = page.locator('[data-chain="stellar"]').first();
    if (await stellarTab.isVisible()) await stellarTab.click();
  });

  test('Freighter shows as Installed when extension is detected', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();

    // Wait for detection
    await page.waitForFunction(() => !document.body.textContent?.includes('Detecting…'));

    const freighterOption = page.getByTestId('wallet-option-freighter');
    await expect(freighterOption).toContainText('Installed');
  });

  test('selecting Freighter connects and shows connected button', async ({ page }) => {
    await page.getByTestId('wallet-connect-button').click();
    await page.getByTestId('wallet-option-freighter').click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('wallet-connected-button')).toBeVisible({ timeout: 5000 });
  });
});
