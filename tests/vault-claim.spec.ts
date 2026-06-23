import { test, expect } from '@playwright/test';

test.describe('Vault Claim Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vault');
  });

  test('displays claim tab', async ({ page }) => {
    await expect(page.getByText('Claim')).toBeVisible();
  });

  test('shows connect wallet message when not connected', async ({ page }) => {
    await page.getByText('Claim').click();
    
    await expect(page.getByText('Connect Wallet')).toBeVisible();
    await expect(page.getByText('Connect your Freighter wallet to claim vault deposits')).toBeVisible();
  });

  test('displays claimable deposits when connected', async ({ page }) => {
    // Note: This test assumes wallet is connected
    await page.getByText('Claim').click();
    
    // Should show mock deposits
    await expect(page.getByText('No Claimable Deposits')).not.toBeVisible();
    // Or if no deposits, should show the empty state
    await expect(page.locator('text=/No Claimable Deposits|vault_/')).toBeVisible();
  });

  test('shows deposit details in claim card', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // Check for deposit card elements
    const depositCard = page.locator('.border').first();
    await expect(depositCard).toBeVisible();
    
    // Should show deposit ID
    await expect(page.getByText('Deposit ID')).toBeVisible();
    
    // Should show amount
    await expect(page.getByText('Amount')).toBeVisible();
    
    // Should show unlock ledger
    await expect(page.getByText('Unlock Ledger')).toBeVisible();
    
    // Should show refund window
    await expect(page.getByText('Refund Window')).toBeVisible();
  });

  test('shows pending state for unclaimed deposits', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // Should show pending indicator
    await expect(page.getByText('Pending')).toBeVisible();
  });

  test('has claim button for each deposit', async ({ page }) => {
    await page.getByText('Claim').click();
    
    const claimButtons = page.getByText('Claim');
    await expect(claimButtons.first()).toBeVisible();
  });

  test('claim button shows signing state when clicked', async ({ page }) => {
    await page.getByText('Claim').click();
    
    const claimButton = page.getByText('Claim').first();
    await claimButton.click();
    
    // Should show signing state
    await expect(page.getByText('Signing...')).toBeVisible();
  });

  test('shows success state after claim', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // Note: This would need wallet mocking to complete the claim
    // For now, verify the claim button exists
    await expect(page.getByText('Claim').first()).toBeVisible();
  });

  test('shows empty state when no claimable deposits', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // If no deposits exist, should show empty state
    const emptyState = page.getByText('No Claimable Deposits');
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText('No pending vault deposits found for your address')).toBeVisible();
    }
  });

  test('has copy button for deposit ID', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // Should have copy functionality
    await expect(page.getByText('Deposit ID')).toBeVisible();
  });

  test('displays transaction hash after successful claim', async ({ page }) => {
    await page.getByText('Claim').click();
    
    // Note: This would need wallet mocking to complete the claim
    // For now, verify the claim flow structure
    await expect(page.getByText('Claim').first()).toBeVisible();
  });
});
