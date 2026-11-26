import {
  beginVisualCase,
  captureVisual,
  connectVisualWallet,
  DEPOSIT_ID,
  expect,
  installVaultVisualMocks,
  MOCK_TX_HASH,
  RECIPIENT_META,
  selectVisualChain,
  test,
  visualMasks,
} from './visual-fixtures';

async function openDepositForm(
  page: Parameters<typeof installVaultVisualMocks>[0],
  theme: 'light' | 'dark',
  testInfo: Parameters<typeof beginVisualCase>[1],
  state: string,
) {
  await page.goto('/vault');
  await selectVisualChain(page, 'stellar');
  await beginVisualCase(page, testInfo, '/vault', state, theme);
  await connectVisualWallet(page, 'Connect Freighter');
  await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
  await page.getByPlaceholder('0.0').fill('10.5');
  await page.getByPlaceholder('e.g., 100000', { exact: true }).fill('500000');
  await page.getByPlaceholder('e.g., 10000', { exact: true }).fill('10000');
}

for (const theme of ['light', 'dark'] as const) {
  test(`/vault | stellar-vault-simulating | ${theme}`, async ({ page }, testInfo) => {
    await installVaultVisualMocks(page, { simulationPending: true });
    await openDepositForm(page, theme, testInfo, 'stellar-vault-simulating');
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Simulating on Stellar Testnet...')).toBeVisible();
    await captureVisual(page, `stellar-vault-simulating-${theme}`);
  });

  test(`/vault | stellar-vault-signing | ${theme}`, async ({ page }, testInfo) => {
    await installVaultVisualMocks(page, { signingPending: true });
    await openDepositForm(page, theme, testInfo, 'stellar-vault-signing');
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Awaiting wallet signature...')).toBeVisible();
    await captureVisual(page, `stellar-vault-signing-${theme}`);
  });

  test(`/vault | stellar-vault-pending | ${theme}`, async ({ page }, testInfo) => {
    await installVaultVisualMocks(page, { submissionPending: true });
    await openDepositForm(page, theme, testInfo, 'stellar-vault-pending');
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Transaction pending on-chain...')).toBeVisible();
    await captureVisual(page, `stellar-vault-pending-${theme}`);
  });

  test(`/vault | stellar-vault-success | ${theme}`, async ({ page }, testInfo) => {
    await installVaultVisualMocks(page);
    await openDepositForm(page, theme, testInfo, 'stellar-vault-success');
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Deposit Created')).toBeVisible();
    await expect(page.getByText(DEPOSIT_ID, { exact: true })).toBeVisible();
    await expect(page.locator(`a[href*="${MOCK_TX_HASH}"]`)).toBeVisible();
    await captureVisual(page, `stellar-vault-success-${theme}`, [
      visualMasks.vaultDepositId(page),
      visualMasks.transactionHash(page),
    ]);
  });

  test(`/vault | stellar-vault-failure | ${theme}`, async ({ page }, testInfo) => {
    await installVaultVisualMocks(page, { pollStatus: 'FAILED' });
    await openDepositForm(page, theme, testInfo, 'stellar-vault-failure');
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Deposit failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Vault deposit failed on Stellar Testnet')).toBeVisible();
    await captureVisual(page, `stellar-vault-failure-${theme}`);
  });
}
