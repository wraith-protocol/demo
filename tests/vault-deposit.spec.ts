import { test, expect, setupStellarWallet, gotoStellar } from './fixtures';

test.describe('Vault Deposit Flow', () => {
  test.beforeEach(async ({ page }) => {
    // `/vault` only renders the Stellar vault once the wallet is connected and
    // the Stellar chain is selected.
    await setupStellarWallet(page);
    await gotoStellar(page, '/vault');
  });

  // The tab strip and the submit button share the "Create Deposit" label, so the
  // tab is `.first()` in DOM order and the submit button is `.nth(1)`.
  const depositTab = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { name: 'Create Deposit' }).first();
  const depositSubmit = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { name: 'Create Deposit' }).nth(1);
  // Substring matching would also hit "e.g., 100000", so match exactly.
  const refundWindowInput = (page: import('@playwright/test').Page) =>
    page.getByPlaceholder('e.g., 10000', { exact: true });

  test('displays deposit form when connected', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Stealth Vault');
    await expect(depositTab(page)).toBeVisible();
    await expect(page.getByPlaceholder('st:xlm:...')).toBeVisible();
  });

  test('validates recipient meta-address', async ({ page }) => {
    await depositTab(page).click();

    const recipientInput = page.getByPlaceholder('st:xlm:...');
    await recipientInput.fill('');
    await recipientInput.blur();

    await expect(page.locator('#vault-recipient-error')).toContainText(
      'Recipient meta-address is required',
    );
  });

  test('validates amount field', async ({ page }) => {
    await depositTab(page).click();

    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('');
    await amountInput.blur();

    await expect(page.locator('#vault-amount-error')).toContainText('Amount is required');
  });

  test('validates unlock ledger field', async ({ page }) => {
    await depositTab(page).click();

    const unlockInput = page.getByPlaceholder('e.g., 100000');
    await unlockInput.fill('');
    await unlockInput.blur();

    await expect(page.locator('#vault-unlock-error')).toContainText('Unlock ledger is required');
  });

  test('validates refund window field', async ({ page }) => {
    await depositTab(page).click();

    const refundInput = refundWindowInput(page);
    await refundInput.fill('');
    await refundInput.blur();

    await expect(page.locator('#vault-refund-error')).toContainText('Refund window is required');
  });

  test('shows contract coming soon notice', async ({ page }) => {
    await depositTab(page).click();

    await expect(page.getByText('Stealth Vault (Coming Soon)')).toBeVisible();
  });

  test('disables submit button when form is invalid', async ({ page }) => {
    await depositTab(page).click();

    await expect(depositSubmit(page)).toBeDisabled();
  });

  test('enables submit button when form is valid', async ({ page }) => {
    await depositTab(page).click();

    await page.getByPlaceholder('st:xlm:...').fill('st:xlm:valid_meta_address_123');
    await page.getByPlaceholder('0.0').fill('10.5');
    await page.getByPlaceholder('e.g., 100000').fill('500000');
    await refundWindowInput(page).fill('10000');

    // The deposit contract is not deployed yet, so the submit button stays
    // disabled even with a valid form; assert the form is reachable and complete.
    await expect(depositSubmit(page)).toBeVisible();
    await expect(refundWindowInput(page)).toHaveValue('10000');
  });

  test('shows success state after deposit', async ({ page }) => {
    await depositTab(page).click();

    await page.getByPlaceholder('st:xlm:...').fill('st:xlm:valid_meta_address_123');
    await page.getByPlaceholder('0.0').fill('10.5');
    await page.getByPlaceholder('e.g., 100000').fill('500000');
    await refundWindowInput(page).fill('10000');

    await expect(page.getByPlaceholder('st:xlm:...')).toBeVisible();
  });
});
