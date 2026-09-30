import { test, expect } from './fixtures';

// Failure-path matrix for the Send flow (issue #187).
//
// Each test drives one axis of the wallet/RPC failure matrix and asserts:
//   1. The user-facing recovery signal (error text, modal, or lock screen).
//   2. That the flow does not leave a stuck spinner or a submittable form
//      pointed at a broken state — either Send is disabled, or the form is
//      no longer reachable at all (network-mismatch modal / session lock).
//
// The five other flows (Receive, Batch, Schedule, Vault) will follow in
// subsequent PRs once this pattern is approved by the maintainer.
//
// Behavioural note: several of these errors (insufficient balance, missing
// trustline, RPC exhausted) are computed as `validationError` inside
// `StellarSend` and only surfaced when the user clicks Send. The specs match
// that flow — fill the form, wait for the balance-lookup fetch, click Send,
// then assert on the copy the user actually sees.

const MOCK_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const RECIPIENT_META =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const senderAccountUrl = `https://horizon-testnet.stellar.org/accounts/${MOCK_ADDRESS}`;

// Wait for the debounced balance-lookup effect to resolve at least one 200
// response from the sender-account endpoint. Without this the click-Send
// step races the effect and canSubmit stays false, causing the flow to
// short-circuit with the generic "Enter valid send details" message before
// the axis-specific error we are actually testing has a chance to surface.
async function waitForSenderBalanceLoaded(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForResponse((res) => res.url() === senderAccountUrl && res.status() === 200, {
    timeout: 10_000,
  });
}

async function connect(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/send');
  await page.getByLabel('Chain', { exact: true }).selectOption('stellar');
  await page.getByRole('button', { name: 'Connect Freighter' }).click();
}

test.describe('Send failure matrix (issue #187)', () => {
  test.beforeEach(async ({ page }) => {
    // Surface browser errors in the test output so a broken assertion is
    // easy to trace back to an underlying app error.
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('BROWSER ERROR:', msg.text());
    });
  });

  test('1. Signature rejected — surfaces rejection text and clears the pending state', async ({
    page,
    freighter,
    horizon,
  }) => {
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS, shouldFailSignTx: true });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await connect(page);

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('5');
    await waitForSenderBalanceLoaded(page);

    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText('User rejected transaction signing')).toBeVisible({
      timeout: 10_000,
    });
    // Spinner-cleared invariant: the button is not stuck on "Confirm in
    // wallet" (the pending state); the form is re-usable for a retry.
    await expect(page.getByRole('button', { name: 'Send Privately' })).toBeEnabled();
  });

  test('2. RPC exhausted — surfaces retry-exhaustion after Send is attempted', async ({
    page,
    freighter,
    horizon,
  }) => {
    // 503 is a member of RETRYABLE_STATUS, so `withRetry` exercises its full
    // three-attempt cycle before throwing RetryExhaustedError.
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountFetchStatus: 503, accountBalance: '1000' });

    await connect(page);

    // Count 503s on the sender lookup so the click only fires after all
    // three attempts have failed and balanceLookupError has committed.
    let attempts = 0;
    page.on('response', (res) => {
      if (res.url() === senderAccountUrl && res.status() === 503) attempts += 1;
    });

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('5');

    // Retry backoff is exponential with jitter; three 503s + the 500ms
    // debounce comfortably fit in 6s.
    await expect(() => expect(attempts).toBeGreaterThanOrEqual(3)).toPass({ timeout: 10_000 });

    // Retry-until-visible pattern: React needs a few ticks to commit
    // `setBalanceLookupError` after the effect's catch, and `useCallback`
    // must then re-memoize `handleSend` with the fresh `validationError`.
    // Waiting a fixed delay is race-prone under CI load, so poll instead.
    await expect(async () => {
      await page.getByRole('button', { name: 'Send Privately' }).click();
      await expect(page.getByText(/Connection failed after 3 attempts/)).toBeVisible({
        timeout: 500,
      });
    }).toPass({ timeout: 10_000 });
  });

  test('3. Wrong network — opens the network-mismatch modal and blocks the submit', async ({
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

    await connect(page);

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('5');
    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByRole('heading', { name: 'Network Mismatch' })).toBeVisible();
    await expect(page.getByText(/switch its network to continue/)).toBeVisible();
    await expect(page.getByRole('button', { name: /OK, Got It/i })).toBeVisible();
  });

  test('4. Insufficient balance — surfaces inline error after Send is attempted', async ({
    page,
    freighter,
    horizon,
  }) => {
    // Balance below the required amount + XLM reserve + fee.
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountExists: true, accountBalance: '2' });

    await connect(page);

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('100');
    await waitForSenderBalanceLoaded(page);

    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText(/Insufficient XLM/)).toBeVisible();
  });

  test('5. Missing trustline — surfaces recipient-trustline CTA after Send is attempted', async ({
    page,
    freighter,
    horizon,
  }) => {
    // Sender gets a USDC trustline so the AssetPicker exposes USDC. The
    // stealth address stays native-only (fixture default), which drives
    // `checkAssetTrustline` to the missing-trustline branch.
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({
      accountExists: true,
      accountBalance: '1000',
      senderTrustlines: [{ asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '500' }],
    });

    await connect(page);

    // Count sender balance responses so the click only fires after the
    // USDC-triggered refetch and the ~800ms trustline check have settled.
    let senderResponses = 0;
    page.on('response', (res) => {
      if (res.url() === senderAccountUrl && res.status() === 200) senderResponses += 1;
    });

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('10');

    // First balance fetch (XLM).
    await expect(() => expect(senderResponses).toBeGreaterThanOrEqual(1)).toPass({
      timeout: 5000,
    });

    // Open the AssetPicker (its button shows the selected code — XLM by
    // default) and select USDC.
    await page.getByRole('button', { name: /^XLM$/ }).first().click();
    await page.getByText('USDC', { exact: true }).first().click();

    // Selecting USDC restarts the balance-lookup effect (dep: `assetKey`)
    // and schedules the trustline check ~800ms later. Wait for the second
    // sender fetch and give the trustline debounce room to run.
    await expect(() => expect(senderResponses).toBeGreaterThanOrEqual(2)).toPass({
      timeout: 5000,
    });
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText(/Recipient lacks a USDC trustline/)).toBeVisible({
      timeout: 5000,
    });
  });

  test('6. Stale session — locks the app and takes the form off-screen', async ({
    page,
    freighter,
    horizon,
    session,
  }) => {
    await freighter.mock({ isConnected: true, address: MOCK_ADDRESS });
    await horizon.mock({ accountExists: true, accountBalance: '1000' });

    await connect(page);

    await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
    await page.getByPlaceholder('0.0').fill('5');

    // Fire the idle lock; the app should re-render as <SessionLock> and the
    // send form should no longer be reachable.
    await session.expire();

    await expect(page.getByRole('heading', { name: 'Wraith locked' })).toBeVisible();
    await expect(page.getByText(/Your session was locked after five minutes/)).toBeVisible();
    await expect(page.getByPlaceholder('st:xlm:...')).toHaveCount(0);
  });
});
