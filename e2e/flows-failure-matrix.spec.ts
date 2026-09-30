import { test, expect } from './fixtures';

// Failure-path matrix for Receive, Batch, Schedule, and Vault (issue #187).
//
// One spec per flow-axis pair, following the same shape as
// `send-failure-matrix.spec.ts`. Axes marked n/a for a flow (for example
// insufficient-balance on Receive, or any wallet axis on Schedule) are
// documented rather than asserted; #187's DoD is that the recovery path
// works everywhere it CAN fail, not that every flow gets every axis.

const MOCK_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const RECIPIENT_META =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

async function selectStellar(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Chain', { exact: true }).selectOption('stellar');
}

async function connectFreighter(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect Freighter' }).click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Receive
// ─────────────────────────────────────────────────────────────────────────────
//
// Applicable axes: signature-rejected (Derive Keys signs a message),
// wrong-network (Register/Withdraw both gate on isNetworkMismatch),
// stale-session (any page). Insufficient-balance / missing-trustline / RPC
// exhaustion are n/a here: Receive derives keys and scans, it does not
// consume sender funds and does not go through the AssetPicker.

test.describe('Receive failure matrix (issue #187)', () => {
  test('Signature rejected on Derive Keys surfaces a rejection message', async ({
    page,
    freighter,
    horizon,
  }) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_ADDRESS,
      shouldFailSignMessage: true,
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await page.goto('/receive');
    await selectStellar(page);
    await connectFreighter(page);

    await page.getByRole('button', { name: 'Derive Keys' }).click();

    await expect(page.getByText('User rejected signature')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Derive Keys' })).toBeEnabled();
  });

  test('Stale session on Receive locks the app', async ({ page, freighter, horizon, session }) => {
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await page.goto('/receive');
    await selectStellar(page);
    await connectFreighter(page);

    await session.expire();

    await expect(page.getByRole('heading', { name: 'Wraith locked' })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch (StellarSplit)
// ─────────────────────────────────────────────────────────────────────────────
//
// Applicable axes: signature-rejected (sendBatch → signTransaction),
// wrong-network (via the same wallet context), stale-session.
// Insufficient-balance / missing-trustline surface per-row inside sendBatch
// and would need row-level fixture work that a follow-up PR can add on top
// of the reusable fixture surface this PR delivers.

const BATCH_CSV = `st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb,5
st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb,3`;

test.describe('Batch failure matrix (issue #187)', () => {
  test('Signature rejected on Send Batch surfaces a rejection message', async ({
    page,
    freighter,
    horizon,
  }) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_ADDRESS,
      shouldFailSignTx: true,
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await page.goto('/stellar/split');
    await selectStellar(page);
    await connectFreighter(page);

    // Fill CSV, validate, then attempt to send.
    await page.getByRole('textbox').first().fill(BATCH_CSV);
    await page.getByRole('button', { name: /Validate CSV/i }).click();
    await page.getByRole('button', { name: /Send Batch/i }).click();

    // Batch signature failures bubble up either as the raw rejection or as
    // the "Transaction failed" fallback depending on where inside sendBatch
    // the signer throws; either is a passing failure surface.
    await expect(
      page.getByText(/User rejected transaction signing|Transaction failed/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Stale session on Batch locks the app', async ({ page, freighter, horizon, session }) => {
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await page.goto('/stellar/split');
    await selectStellar(page);
    await connectFreighter(page);

    await session.expire();

    await expect(page.getByRole('heading', { name: 'Wraith locked' })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────────────────────
//
// Schedule is a local-only Zustand store with a mock tick executor; it does
// not touch the wallet or Horizon or Soroban. The only wallet/RPC failure
// axis that applies here is stale-session (which affects the whole app),
// so that is the single meaningful assertion for this flow.

test.describe('Schedule failure matrix (issue #187)', () => {
  test('Stale session on Schedule locks the app', async ({ page, session }) => {
    await page.goto('/schedule');

    await session.expire();

    await expect(page.getByRole('heading', { name: 'Wraith locked' })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vault
// ─────────────────────────────────────────────────────────────────────────────
//
// Applicable axes: wrong-network on Claim (only surface that gates on
// isNetworkMismatch today), signature-rejected on Claim (which signs a
// message per deposit), stale-session on the Vault page.
// Insufficient-balance / trustline / RPC-exhaust do not apply to the
// current Vault UI, which is a UI shell with a simulated executor while
// the on-chain contract is pending.

test.describe('Vault failure matrix (issue #187)', () => {
  // Assertions run against the Deposit tab (default), which is the vault
  // surface that reaches the wallet directly. The Claim tab now requires a
  // full derive-keys + scan-contract precondition before a Claim button
  // exists; exercising that whole chain is a follow-up spec.

  const RECIPIENT = RECIPIENT_META;
  const VALID_AMOUNT = '5';
  const VALID_UNLOCK = '100000';
  const VALID_REFUND = '10000';

  async function fillDepositForm(page: import('@playwright/test').Page): Promise<void> {
    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT);
    await page.getByPlaceholder('0.0').fill(VALID_AMOUNT);
    await page.getByPlaceholder('e.g., 100000', { exact: true }).fill(VALID_UNLOCK);
    await page.getByPlaceholder('e.g., 10000', { exact: true }).fill(VALID_REFUND);
  }

  // The Deposit form gates its submit button on `getVaultContractId()`. In a
  // deployed build that reads from either `VITE_STELLAR_VAULT_CONTRACT_ID`
  // or `window.__WRAITH_CONFIG__`; the e2e environment sets neither, so the
  // submit button stays disabled forever without this init script.
  async function injectVaultContract(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(() => {
      (window as unknown as { __WRAITH_CONFIG__: Record<string, string> }).__WRAITH_CONFIG__ = {
        stellarVaultContractId: 'CAV4LTHU7BJZL7XPCF6NZ4CPZW3DFI74LB57L4HAZ5NZAFYFJIWKM2LU',
      };
    });
  }

  test('Wrong network on Deposit surfaces the switch-network prompt', async ({
    page,
    freighter,
    horizon,
  }) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_ADDRESS,
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });
    await injectVaultContract(page);

    await page.goto('/vault');
    await selectStellar(page);
    await connectFreighter(page);

    await fillDepositForm(page);
    // Two "Create Deposit" nodes exist: the tab button and the submit
    // button. Take the last, which is the submit.
    await page
      .getByRole('button', { name: /^Create Deposit$/i })
      .last()
      .click();

    await expect(
      page.getByText(/Switch Freighter to Stellar Testnet before creating a deposit/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Signature rejected on Deposit surfaces a rejection message', async ({
    page,
    freighter,
    horizon,
  }) => {
    await freighter.mock({
      isConnected: true,
      address: MOCK_ADDRESS,
      shouldFailSignTx: true,
    });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });
    await injectVaultContract(page);

    await page.goto('/vault');
    await selectStellar(page);
    await connectFreighter(page);

    await fillDepositForm(page);
    // Two "Create Deposit" nodes exist: the tab button and the submit
    // button. Take the last, which is the submit.
    await page
      .getByRole('button', { name: /^Create Deposit$/i })
      .last()
      .click();

    // Signing failures bubble up as the raw wallet message or as the
    // generic "Deposit failed" fallback depending on which step throws.
    await expect(page.getByText(/User rejected transaction signing|Deposit failed/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Stale session on Vault locks the app', async ({ page, freighter, horizon, session }) => {
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await page.goto('/vault');
    await selectStellar(page);
    await connectFreighter(page);

    await session.expire();

    await expect(page.getByRole('heading', { name: 'Wraith locked' })).toBeVisible();
  });
});
