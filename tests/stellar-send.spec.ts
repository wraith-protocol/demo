import { test, expect, type Page } from '@playwright/test';

const SOURCE_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_META_ADDRESS =
  'st:xlm:8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394';

async function mockFreighter(page: Page) {
  await page.addInitScript((address) => {
    window.freighter = true;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (event.source !== window || data?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

      const response = {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: data.messageId,
      };

      if (data.type === 'REQUEST_CONNECTION_STATUS') {
        window.postMessage({ ...response, isConnected: true }, window.location.origin);
      }

      if (data.type === 'REQUEST_PUBLIC_KEY' || data.type === 'REQUEST_ACCESS') {
        window.postMessage({ ...response, publicKey: address }, window.location.origin);
      }

      if (data.type === 'SUBMIT_TRANSACTION') {
        window.postMessage(
          { ...response, signedTransaction: data.transactionXdr, signerAddress: address },
          window.location.origin,
        );
      }
    });
  }, SOURCE_ADDRESS);
}

async function mockSourceBalance(page: Page, balance: string, subentryCount = 0) {
  await page.route(`https://horizon-testnet.stellar.org/accounts/${SOURCE_ADDRESS}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sequence: '1',
        subentry_count: subentryCount,
        balances: [{ asset_type: 'native', balance }],
      }),
    }),
  );
}

async function openStellarSend(page: Page) {
  await mockFreighter(page);
  await page.goto('/send');
  await page.getByRole('combobox').selectOption('stellar');
  await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible();
}

test('shows inline error for malformed Stellar meta-address before wallet signing', async ({
  page,
}) => {
  await mockSourceBalance(page, '10.0000000');
  await openStellarSend(page);

  const recipient = page.getByPlaceholder('st:xlm:...');
  await recipient.fill('st:xlm:not-a-valid-payload');
  await recipient.blur();

  await expect(page.locator('#stellar-recipient-error')).toHaveText(
    'Not a valid Stellar stealth meta-address',
  );
  await expect(recipient).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Send Privately' })).toBeDisabled();
});

test('rejects non-positive or over-precision XLM amounts', async ({ page }) => {
  await mockSourceBalance(page, '10.0000000');
  await openStellarSend(page);

  const amount = page.getByPlaceholder('0.0');
  await amount.fill('0.00000001');
  await amount.blur();

  await expect(page.locator('#stellar-amount-error')).toHaveText(
    'Amount must be greater than 0.0000001 XLM with at most 7 decimals',
  );
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Send Privately' })).toBeDisabled();
});

test('debounces the Horizon balance check and blocks insufficient XLM', async ({ page }) => {
  let accountRequests = 0;
  await page.route(`https://horizon-testnet.stellar.org/accounts/${SOURCE_ADDRESS}`, (route) => {
    accountRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sequence: '1',
        subentry_count: 0,
        balances: [{ asset_type: 'native', balance: '1.5000000' }],
      }),
    });
  });
  await openStellarSend(page);

  await page.getByPlaceholder('st:xlm:...').fill(VALID_META_ADDRESS);
  const amount = page.getByPlaceholder('0.0');
  await amount.fill('1');
  await page.waitForTimeout(400);
  expect(accountRequests).toBe(0);
  await amount.blur();

  await expect(page.locator('#stellar-balance-error')).toHaveText(
    'Insufficient XLM (you have 1.5, need 2.00001)',
  );
  await expect(page.getByRole('button', { name: 'Send Privately' })).toBeDisabled();
});

test('enables submit after valid meta-address, amount, and sufficient balance', async ({
  page,
}) => {
  await mockSourceBalance(page, '10.0000000');
  await openStellarSend(page);

  await page.getByPlaceholder('st:xlm:...').fill(VALID_META_ADDRESS);
  const amount = page.getByPlaceholder('0.0');
  await amount.fill('1.2345678');

  await expect(page.locator('#stellar-balance-error')).toHaveText('Checking XLM balance...');
  await amount.blur();
  await expect(page.getByRole('button', { name: 'Send Privately' })).toBeEnabled();
});
