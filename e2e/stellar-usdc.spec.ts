import { test, expect } from '@playwright/test';

test.describe('Stellar USDC Asset Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/send');
  });

  test('shows asset selector with XLM and USDC options', async ({ page }) => {
    const select = page.locator('select');
    await expect(select).toBeVisible();

    const options = select.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('XLM');
    await expect(options.nth(1)).toHaveText('USDC');
  });

  test('shows XLM as default selected asset', async ({ page }) => {
    const select = page.locator('select');
    await expect(select).toHaveValue('XLM');
  });

  test('switching to USDC shows trustline section when no recipient entered', async ({ page }) => {
    const select = page.locator('select');
    await select.selectOption('USDC');
    await expect(select).toHaveValue('USDC');

    const amountLabel = page.locator('label:has-text("Amount")');
    await expect(amountLabel).toBeVisible();

    const sendBtn = page.locator('button:has-text("Send")');
    await expect(sendBtn).toBeDisabled();
  });

  test('displays amount input with asset suffix', async ({ page }) => {
    const amountInput = page.locator('input[type="text"]').nth(1);
    await amountInput.fill('100');

    const amountSuffix = page.locator('text=XLM').first();
    await expect(amountSuffix).toBeVisible();
  });

  test('switches amount suffix when asset changes', async ({ page }) => {
    const select = page.locator('select');
    await select.selectOption('USDC');

    const amountSuffix = page.locator('text=USDC').first();
    await expect(amountSuffix).toBeVisible();
  });

  test('shows StellarReceive page with correct heading', async ({ page }) => {
    await page.goto('/receive');
    const heading = page.locator('h1:has-text("Receive")');
    await expect(heading).toBeVisible();
  });

  test('StellarReceive shows per-asset balance columns', async ({ page }) => {
    await page.goto('/receive');
    await expect(page.locator('text=XLM')).toBeVisible();
    await expect(page.locator('text=USDC')).toBeVisible();
  });

  test('send button text updates with selected asset', async ({ page }) => {
    const sendBtn = page.locator('button:has-text("Send")');

    await expect(sendBtn).toHaveText(/Send XLM Privately/);

    const select = page.locator('select');
    await select.selectOption('USDC');
    await expect(sendBtn).toHaveText(/Send USDC Privately/);
  });
});
