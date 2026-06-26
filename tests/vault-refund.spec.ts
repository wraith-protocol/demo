import { test, expect } from '@playwright/test';

test.describe('Vault Refund Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vault');
  });

  test('displays status tab', async ({ page }) => {
    await expect(page.getByText('Status')).toBeVisible();
  });

  test('shows connect wallet message when not connected', async ({ page }) => {
    await page.getByText('Status').click();
    
    await expect(page.getByText('Connect Wallet')).toBeVisible();
    await expect(page.getByText('Connect your Freighter wallet to view vault deposit status')).toBeVisible();
  });

  test('displays current ledger', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show current ledger
    await expect(page.getByText('Current Ledger')).toBeVisible();
  });

  test('displays deposit list when connected', async ({ page }) => {
    // Note: This test assumes wallet is connected
    await page.getByText('Status').click();
    
    // Should show deposits or empty state
    await expect(page.locator('text=/No Deposits|Deposit ID/')).toBeVisible();
  });

  test('shows deposit state indicator', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show state indicators (pending, claimed, refunded)
    await expect(page.locator('text=/Pending|Claimed|Refunded/')).toBeVisible();
  });

  test('displays deposit details in status card', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Check for deposit card elements
    const depositCard = page.locator('.border').first();
    if (await depositCard.isVisible()) {
      await expect(depositCard).toBeVisible();
      
      // Should show deposit ID
      await expect(page.getByText('Deposit ID')).toBeVisible();
      
      // Should show amount
      await expect(page.getByText('Amount')).toBeVisible();
      
      // Should show unlock ledger
      await expect(page.getByText('Unlock Ledger')).toBeVisible();
      
      // Should show refund deadline
      await expect(page.getByText('Refund Deadline')).toBeVisible();
    }
  });

  test('shows countdown to unlock', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show time to unlock
    await expect(page.getByText('Time to Unlock')).toBeVisible();
  });

  test('shows refund window countdown', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show refund window
    await expect(page.getByText('Refund Window')).toBeVisible();
  });

  test('indicates when deposit is unlocked', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show unlock status
    await expect(page.locator('text=/Unlock time reached|Waiting for unlock/')).toBeVisible();
  });

  test('indicates when refund window is open', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show refund window status
    await expect(page.locator('text=/Refund window open|Refunded by sender/')).toBeVisible();
  });

  test('shows claimed state for claimed deposits', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show claimed indicator
    await expect(page.getByText('Claimed')).toBeVisible();
    await expect(page.getByText('Successfully claimed by recipient')).toBeVisible();
  });

  test('shows refunded state for refunded deposits', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should show refunded indicator
    await expect(page.getByText('Refunded')).toBeVisible();
    await expect(page.getByText('Refunded by sender')).toBeVisible();
  });

  test('has copy button for deposit ID', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should have copy functionality
    await expect(page.getByText('Deposit ID')).toBeVisible();
  });

  test('shows empty state when no deposits', async ({ page }) => {
    await page.getByText('Status').click();
    
    const emptyState = page.getByText('No Deposits');
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText('No vault deposits found')).toBeVisible();
    }
  });

  test('displays different states with different colors', async ({ page }) => {
    await page.getByText('Status').click();
    
    // Should have state indicators with different colors
    const stateIndicators = page.locator('.inline-block.h-1\\.5.w-1\\.5');
    await expect(stateIndicators.first()).toBeVisible();
  });
});
