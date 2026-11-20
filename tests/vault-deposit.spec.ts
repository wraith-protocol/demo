import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Live vault-deposit flow.
 *
 * The deposit form drives `submitVaultDeposit` (src/lib/stellar/vaultDeposit.ts),
 * which talks to Soroban RPC and the Freighter wallet. Both are replaced here by
 * deterministic in-page doubles:
 *
 *  - `window.freighterMock` is consumed by StellarWalletContext instead of the
 *    real Freighter extension.
 *  - `window.sorobanServerMock` is consumed by `getServer()` instead of a live
 *    `rpc.Server`, and every call is recorded on `window.__vaultCalls` so the
 *    simulate -> assemble -> sign -> send -> poll ordering can be asserted.
 *
 * No network request or browser extension is involved.
 */

const SENDER = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const DEPOSIT_ID = 'ab'.repeat(32);
const TX_HASH = 'vault-deposit-tx-hash';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RECIPIENT_META_ADDRESS =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';
const STORAGE_KEY = `wraith:stellar-vault-deposits:v1:${SENDER}`;

interface VaultMockOptions {
  simulationError?: string;
  walletRejectsSignature?: boolean;
  submitError?: string;
  pollStatus?: 'SUCCESS' | 'FAILED';
}

async function installVaultMocks(page: Page, options: VaultMockOptions = {}) {
  await page.addInitScript(
    (cfg) => {
      const calls: string[] = [];
      (window as unknown as { __vaultCalls: string[] }).__vaultCalls = calls;
      (window as unknown as { __WRAITH_CONFIG__: unknown }).__WRAITH_CONFIG__ = {
        stellarVaultContractId: cfg.contract,
      };

      (window as any).freighterMock = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: false }),
        requestAccess: async () => ({ address: cfg.sender }),
        getAddress: async () => ({ address: cfg.sender }),
        getNetworkDetails: async () => ({
          network: 'TESTNET',
          networkPassphrase: cfg.networkPassphrase,
        }),
        signTransaction: async (transactionXdr: string) => {
          calls.push('sign');
          if (cfg.walletRejectsSignature) throw new Error('User rejected transaction signing');
          return { signedTxXdr: transactionXdr };
        },
        WatchWalletChanges: class {
          watch() {}
          stop() {}
        },
      };

      (window as any).sorobanServerMock = {
        getAccount: async (address: string) => {
          calls.push('getAccount');
          return {
            accountId: () => address,
            sequenceNumber: () => '1',
            incrementSequenceNumber: () => {},
          };
        },
        simulateTransaction: async () => {
          calls.push('simulate');
          if (cfg.simulationError) return { error: cfg.simulationError };
          return { minResourceFee: '250', result: {} };
        },
        assembleTransaction: async (transaction: unknown) => {
          calls.push('assemble');
          return { build: () => transaction };
        },
        sendTransaction: async () => {
          calls.push('send');
          if (cfg.submitError) return { status: 'ERROR', errorResult: cfg.submitError };
          return { status: 'PENDING', hash: cfg.txHash };
        },
        pollTransaction: async (hash: string) => {
          calls.push('poll');
          return { status: cfg.pollStatus, hash, returnValue: cfg.depositId };
        },
      };
    },
    {
      sender: SENDER,
      contract: CONTRACT,
      depositId: DEPOSIT_ID,
      txHash: TX_HASH,
      networkPassphrase: NETWORK_PASSPHRASE,
      simulationError: options.simulationError ?? '',
      walletRejectsSignature: options.walletRejectsSignature ?? false,
      submitError: options.submitError ?? '',
      pollStatus: options.pollStatus ?? 'SUCCESS',
    },
  );
}

async function connectVault(page: Page) {
  await page.goto('/vault');
  await page.getByLabel('Chain').selectOption('stellar');
  await page.getByRole('button', { name: 'Connect Freighter' }).click();
  await expect(page.getByPlaceholder('st:xlm:...')).toBeVisible();
}

async function fillDepositForm(page: Page, values: { amount?: string } = {}) {
  await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META_ADDRESS);
  await page.getByPlaceholder('0.0').fill(values.amount ?? '10.5');
  await page.getByPlaceholder('e.g., 100000', { exact: true }).fill('500000');
  await page.getByPlaceholder('e.g., 10000', { exact: true }).fill('10000');
}

async function vaultCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __vaultCalls: string[] }).__vaultCalls);
}

async function readPersistedDeposits(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  }, STORAGE_KEY);
}

test.describe('Vault Deposit Flow', () => {
  test('simulates, assembles, signs and confirms a deposit, then persists it', async ({ page }) => {
    await installVaultMocks(page);
    await connectVault(page);
    await fillDepositForm(page);

    await page.getByTestId('vault-deposit-submit').click();

    await expect(page.getByText('Deposit Created')).toBeVisible();
    await expect(page.getByText(DEPOSIT_ID)).toBeVisible();
    await expect(page.getByText(TX_HASH)).toBeVisible();

    expect(await vaultCalls(page)).toEqual([
      'getAccount',
      'simulate',
      'assemble',
      'sign',
      'send',
      'poll',
    ]);

    const persisted = await readPersistedDeposits(page);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      depositId: DEPOSIT_ID,
      txHash: TX_HASH,
      sender: SENDER,
      amount: '10.5',
      unlockLedger: 500_000,
      refundAfter: 510_000,
    });
  });

  test('keeps the persisted deposit across a reload', async ({ page }) => {
    await installVaultMocks(page);
    await connectVault(page);
    await fillDepositForm(page);
    await page.getByTestId('vault-deposit-submit').click();
    await expect(page.getByText('Deposit Created')).toBeVisible();

    await page.reload();

    const persisted = await readPersistedDeposits(page);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].depositId).toBe(DEPOSIT_ID);
  });

  test('reports a rejected simulation and never asks the wallet to sign', async ({ page }) => {
    await installVaultMocks(page, { simulationError: 'Error(Contract, #3)' });
    await connectVault(page);
    await fillDepositForm(page);

    await page.getByTestId('vault-deposit-submit').click();

    await expect(page.getByText('Deposit failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Vault contract rejected the deposit (error #3)')).toBeVisible();

    expect(await vaultCalls(page)).toEqual(['getAccount', 'simulate']);
    expect(await readPersistedDeposits(page)).toEqual([]);
  });

  test('surfaces a wallet rejection without submitting the transaction', async ({ page }) => {
    await installVaultMocks(page, { walletRejectsSignature: true });
    await connectVault(page);
    await fillDepositForm(page);

    await page.getByTestId('vault-deposit-submit').click();

    await expect(page.getByText('Deposit failed', { exact: true })).toBeVisible();
    await expect(page.getByText('User rejected transaction signing')).toBeVisible();

    expect(await vaultCalls(page)).toEqual(['getAccount', 'simulate', 'assemble', 'sign']);
    expect(await readPersistedDeposits(page)).toEqual([]);
  });

  test('reports a submit failure returned by the contract', async ({ page }) => {
    await installVaultMocks(page, { submitError: 'Error(Contract, #9)' });
    await connectVault(page);
    await fillDepositForm(page);

    await page.getByTestId('vault-deposit-submit').click();

    await expect(page.getByText('Deposit failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Vault contract rejected the deposit (error #9)')).toBeVisible();

    expect(await vaultCalls(page)).toEqual(['getAccount', 'simulate', 'assemble', 'sign', 'send']);
    expect(await readPersistedDeposits(page)).toEqual([]);
  });

  test('reports a transaction that fails while polling for confirmation', async ({ page }) => {
    await installVaultMocks(page, { pollStatus: 'FAILED' });
    await connectVault(page);
    await fillDepositForm(page);

    await page.getByTestId('vault-deposit-submit').click();

    await expect(page.getByText('Deposit failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Vault deposit failed on Stellar Testnet')).toBeVisible();

    expect(await vaultCalls(page)).toEqual([
      'getAccount',
      'simulate',
      'assemble',
      'sign',
      'send',
      'poll',
    ]);
    expect(await readPersistedDeposits(page)).toEqual([]);
  });

  test('requires every field before the deposit can be submitted', async ({ page }) => {
    await installVaultMocks(page);
    await connectVault(page);

    const submit = page.getByTestId('vault-deposit-submit');
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder('st:xlm:...').click();
    await page.getByPlaceholder('st:xlm:...').blur();
    await page.getByPlaceholder('0.0').click();
    await page.getByPlaceholder('0.0').blur();
    await page.getByPlaceholder('e.g., 100000', { exact: true }).click();
    await page.getByPlaceholder('e.g., 100000', { exact: true }).blur();
    await page.getByPlaceholder('e.g., 10000', { exact: true }).click();
    await page.getByPlaceholder('e.g., 10000', { exact: true }).blur();

    await expect(page.locator('#vault-recipient-error')).toContainText(
      'Recipient meta-address is required',
    );
    await expect(page.locator('#vault-amount-error')).toContainText('Amount is required');
    await expect(page.locator('#vault-unlock-error')).toContainText('Unlock ledger is required');
    await expect(page.locator('#vault-refund-error')).toContainText('Refund window is required');
    await expect(submit).toBeDisabled();
  });
});
