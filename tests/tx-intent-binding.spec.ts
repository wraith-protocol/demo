import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const SENDER = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';

async function injectFreighterMock(page: Page, signedXdr: string) {
  return page.addInitScript((xdr) => {
    const address = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';
    (window as unknown as Record<string, unknown>).freighterMock = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      requestAccess: () => Promise.resolve({ address }),
      getAddress: () => Promise.resolve({ address }),
      getNetworkDetails: () =>
        Promise.resolve({
          networkPassphrase: 'Test SDF Network ; September 2015',
          network: 'TESTNET',
        }),
      signTransaction: () => Promise.resolve({ signedTxXdr: xdr }),
      signMessage: (message: string) => Promise.resolve({ signedMessage: message }),
    };
  }, signedXdr);
}

async function mockHorizon(page: Page) {
  await page.route('**/horizon-testnet.stellar.org/accounts/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/accounts/${SENDER}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sequence: '123',
          balances: [{ asset_type: 'native', balance: '1000' }],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function mockSoroban(page: Page) {
  await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          minResourceFee: '100',
          events: [],
          transactionData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        },
      }),
    });
  });
}

function buildMetaAddress() {
  return encodeStealthMetaAddress(
    StrKey.decodeEd25519PublicKey(Keypair.random().publicKey()),
    StrKey.decodeEd25519PublicKey(Keypair.random().publicKey()),
  );
}

function buildTamperedXdr() {
  const tampered = new TransactionBuilder(new Account(SENDER, '123'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.createAccount({
        destination: Keypair.random().publicKey(),
        startingBalance: '9',
      }),
    )
    .setTimeout(30)
    .build();

  tampered.sign(Keypair.random());
  return tampered.toXDR();
}

async function openStellarSend(page: Page) {
  await page.goto('/send');
  await page.getByRole('combobox', { name: 'Chain' }).selectOption('stellar');
  await page
    .getByRole('button', { name: /connect/i })
    .first()
    .click();
  await expect(page.getByPlaceholder('st:xlm:...')).toBeVisible({ timeout: 10_000 });
}

test.describe('transaction intent binding', () => {
  test('rejects an altered wallet response without submitting', async ({ page }) => {
    const recipient = buildMetaAddress();

    await injectFreighterMock(page, buildTamperedXdr());
    await mockHorizon(page);
    await mockSoroban(page);

    let submissions = 0;
    await page.route('**/horizon-testnet.stellar.org/transactions', async (route) => {
      submissions += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hash: 'deadbeef' }),
      });
    });

    await openStellarSend(page);
    await page.getByPlaceholder('st:xlm:...').fill(recipient);
    await page.getByPlaceholder('0.0').fill('1');

    await expect(page.getByText('Confirm transaction')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText(/does not match the confirmed intent/)).toBeVisible({
      timeout: 10_000,
    });
    expect(submissions).toBe(0);
  });

  test('invalidates a completed simulation when a signed field changes', async ({ page }) => {
    const recipient = buildMetaAddress();

    await injectFreighterMock(page, buildTamperedXdr());
    await mockHorizon(page);
    await mockSoroban(page);

    await openStellarSend(page);
    await page.getByPlaceholder('st:xlm:...').fill(recipient);
    await page.getByPlaceholder('0.0').fill('1');

    await expect(page.getByText('Confirm transaction')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send Privately' })).toBeEnabled();
    const previousFingerprint = await page.getByTestId('intent-fingerprint').textContent();
    expect(previousFingerprint).toMatch(/^0x[0-9a-f]{64}$/);

    await page.getByPlaceholder('0.0').fill('2');

    const updatedFingerprint = page.getByTestId('intent-fingerprint');
    await expect(updatedFingerprint).toBeVisible({ timeout: 10_000 });
    await expect(updatedFingerprint).not.toHaveText(previousFingerprint ?? '');
    await expect(page.getByTestId('intent-confirmation')).toContainText('2');
  });
});
