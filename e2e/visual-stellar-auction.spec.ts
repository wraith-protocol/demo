import {
  beginVisualCase,
  captureVisual,
  connectVisualWallet,
  expect,
  installAuctionVisualMocks,
  selectVisualChain,
  test,
} from './visual-fixtures';
import type { Page, TestInfo } from '@playwright/test';
import type { FreighterMockConfig } from './fixtures';

async function openAuctions(
  page: Page,
  freighter: { mock: (config: Partial<FreighterMockConfig>) => Promise<void> },
  testInfo: TestInfo,
  theme: 'light' | 'dark',
  state: string,
  shouldFailSignTx = false,
) {
  await freighter.mock({
    isConnected: true,
    address: 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX',
    shouldFailSignTx,
  });
  await installAuctionVisualMocks(page);
  await page.goto('/names/auctions');
  await selectVisualChain(page, 'stellar');
  await beginVisualCase(page, testInfo, '/names/auctions', state, theme);
  await connectVisualWallet(page, 'Connect Freighter');
  await expect(page.getByRole('heading', { name: 'demo.wraith' })).toBeVisible();
}

async function unlockRecoveryVault(page: Page) {
  const passphraseInputs = page.locator('input[placeholder="••••••••"]');
  await passphraseInputs.nth(0).fill('visual fixture passphrase');
  await passphraseInputs.nth(1).fill('visual fixture passphrase');
  await page.getByRole('button', { name: 'Set up encryption' }).click();
  await expect(page.getByText('[Vault unlocked]')).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`/names/auctions | stellar-auction-vault | ${theme}`, async ({
    page,
    freighter,
  }, testInfo) => {
    await openAuctions(page, freighter, testInfo, theme, 'stellar-auction-vault');
    await unlockRecoveryVault(page);
    await expect(page.getByText('0 bid recovery secret(s) held in memory only.')).toBeVisible();
    await captureVisual(page, `stellar-auction-vault-unlocked-${theme}`);
  });

  test(`/names/auctions | stellar-auction-recovery | ${theme}`, async ({
    page,
    freighter,
  }, testInfo) => {
    await openAuctions(page, freighter, testInfo, theme, 'stellar-auction-recovery', true);
    await unlockRecoveryVault(page);
    await page.getByRole('button', { name: 'Place bid' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('0.0').fill('2.5');
    await dialog.getByRole('button', { name: 'Place bid' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Bid was not submitted: User rejected transaction signing',
    );
    await dialog.getByRole('button', { name: 'Close bid modal' }).click();
    const auction = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'demo.wraith' }) });
    await expect(
      auction.getByText('Bid was not submitted. The saved secret is safe to retry.'),
    ).toBeVisible();
    await expect(auction.getByRole('button', { name: 'Retry bid' })).toBeVisible();
    await captureVisual(page, `stellar-auction-recovery-failed-bid-${theme}`);
  });
}
