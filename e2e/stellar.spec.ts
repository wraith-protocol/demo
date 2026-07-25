import { test, expect } from './fixtures';

test.describe('Stellar Stealth Payments E2E Suite', () => {
  test.beforeEach(async ({ page, context }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('BROWSER ERROR:', msg.text());
      } else {
        console.log('BROWSER LOG:', msg.text());
      }
    });

    // Grant clipboard permissions for copy-paste tests if supported (only Chromium supports this)
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch {
      // Ignored for non-chromium browsers
    }
  });

  test('Wallet - 1. Shows Connect Freighter button by default when Stellar chain is selected', async ({
    page,
    freighter,
  }) => {
    await freighter.mock({ isConnected: false });
    await page.goto('/send');
    await page.selectOption('select', 'stellar');

    // Verify correct page state when disconnected
    await expect(page.locator('h1')).toHaveText('Send');
    await expect(
      page.getByText('Connect your Freighter wallet to send stealth payments on Stellar.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
  });

  test('Wallet - 2. Shows installation error if Freighter wallet is not installed', async ({
    page,
    freighter,
  }) => {
    // Mock wallet NOT installed
    await freighter.mock({ isConnected: false });
    await page.goto('/send');
    await page.selectOption('select', 'stellar');

    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Verify error message is shown
    await expect(
      page.getByText('Freighter wallet not found. Please install the Freighter browser extension.'),
    ).toBeVisible();
  });

  test('Wallet - 3. Handles user rejecting connection request', async ({ page, freighter }) => {
    // Mock installed, but connection will fail
    await freighter.mock({ isConnected: true, shouldFailConnect: true });
    await page.goto('/send');
    await page.selectOption('select', 'stellar');

    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Verify error from wallet
    await expect(page.getByText('User rejected connection')).toBeVisible();
  });

  test('Wallet - 4. Successfully connects and triggers auto-signing key derivation', async ({
    page,
    freighter,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({
      isConnected: true,
      address: mockAddress,
    });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Header should show connected wallet address (truncated: GCDU...2XHX)
    await expect(page.getByRole('button', { name: 'GCDU...2XHX' })).toBeVisible();

    // Send form should now be visible since wallet is connected
    await expect(page.getByLabel('Recipient Meta-Address')).toBeVisible();
  });

  test('Wallet - 5. Disconnects wallet correctly when address button is clicked', async ({
    page,
    freighter,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Click on the connected button (displays address) to disconnect
    await page.getByRole('button', { name: 'GCDU...2XHX' }).click();

    // Should return to disconnected state
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
  });

  test('Send - 6. Validates empty input fields and keeps Send button disabled', async ({
    page,
    freighter,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    const sendBtn = page.getByRole('button', { name: 'Send Privately' });
    await expect(sendBtn).toBeDisabled();

    // Fill only recipient
    await page.getByPlaceholder('st:xlm:...').fill('st:xlm:someaddress');
    await expect(sendBtn).toBeDisabled();

    // Clear recipient, fill only amount
    await page.getByPlaceholder('st:xlm:...').clear();
    await page.getByPlaceholder('0.0').fill('10.5');
    await expect(sendBtn).toBeDisabled();
  });

  test('Send - 7. Validates recipient address format prefix', async ({ page, freighter }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Enter wrong prefix
    await page.getByPlaceholder('st:xlm:...').fill('st:eth:invalidprefixaddress');
    await page.getByPlaceholder('0.0').fill('10');
    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText('Enter a valid Stellar meta-address (st:xlm:...)')).toBeVisible();
  });

  test('Send - 8. Successfully executes payment to a new stealth address (creating the account)', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    const recipientMetaAddress =
      'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

    await freighter.mock({ isConnected: true, address: mockAddress });
    // Mock stealth address NOT existing so it creates the account
    await horizon.mock({
      accountExists: false,
      txSuccess: true,
      txHash: 'tx_success_create_account',
    });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByPlaceholder('st:xlm:...').fill(recipientMetaAddress);
    await page.getByPlaceholder('0.0').fill('50');
    await page.getByRole('button', { name: 'Send Privately' }).click();

    // Success screen details
    await expect(page.getByText('Transfer Complete')).toBeVisible();
    await expect(page.getByText('tx_success_create_account')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Transfer' })).toBeVisible();
  });

  test('Send - 9. Successfully executes payment to an existing stealth address (regular payment)', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    const recipientMetaAddress =
      'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

    await freighter.mock({ isConnected: true, address: mockAddress });
    // Mock stealth address ALREADY existing, so it performs a payment
    await horizon.mock({
      accountExists: true,
      accountBalance: '20',
      txSuccess: true,
      txHash: 'tx_success_payment',
    });

    await page.goto('/send');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByPlaceholder('st:xlm:...').fill(recipientMetaAddress);
    await page.getByPlaceholder('0.0').fill('5');
    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText('Transfer Complete')).toBeVisible();
    await expect(page.getByText('tx_success_payment')).toBeVisible();
  });

  test('Receive - 10. Automatically derives keys and shows meta-address on wallet connection', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });
    await horizon.mock({});

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Verify stealth meta-address card is visible
    await expect(page.getByText('Your Stealth Meta-Address')).toBeVisible();
    // Verify it starts with st:xlm: prefix
    const metaAddressElement = page.locator('code').first();
    await expect(metaAddressElement).toContainText('st:xlm:');
  });

  test('Receive - 11. Copies the derived stealth meta-address to clipboard', async ({
    page,
    freighter,
    horizon,
    browserName,
  }) => {
    // Clipboard reading via navigator.clipboard API is only standard/supported on Chromium in headless E2E
    if (browserName !== 'chromium') {
      test.skip();
    }

    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });
    await horizon.mock({});

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Click the copy button
    await page.getByRole('button', { name: 'Copy' }).first().click();

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('st:xlm:');
  });

  test('Receive - 12. Registers derived stealth keys on-chain', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });
    // Mock as NOT registered initially, registration simulation succeeds
    await horizon.mock({ accountExists: true, txSuccess: true, txHash: 'tx_register_hash' });

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    // Click Register On-Chain
    await page.getByRole('button', { name: 'Register On-Chain' }).click();

    // Verify registered indicator shows up
    await expect(page.getByText('Meta-address registered on-chain')).toBeVisible();
  });

  test('Receive - 13. Reports "No transfers found" when scanning yields empty events list', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });
    // Empty events list
    await horizon.mock({ sorobanEvents: [] });

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByRole('button', { name: 'Scan for Payments' }).click();

    await expect(page.getByText('No transfers found')).toBeVisible();
    await expect(page.getByText('No stealth transfers matched your keys.')).toBeVisible();
  });

  test('Receive - 14. Successfully scans, displays matched payment transfers, and reveals keys', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    // Matched stealth address details (must be a valid Stellar public key)
    const matchedStealthAddress = 'GAL77LMANDOA32MTLU3GG3Z22G2543PDIE5REOEOIU5QL4VEYHJ5WKON';

    await freighter.mock({ isConnected: true, address: mockAddress });

    // Mock a Soroban Event matched to this viewing key
    await horizon.mock({
      accountExists: true,
      accountBalance: '100',
      sorobanEvents: [
        {
          schemeId: 1,
          stealthAddress: matchedStealthAddress,
          caller: mockAddress,
          ephemeralPubKey: new Uint8Array(32), // dummy 32-byte ephemeral key
          viewTag: 42,
        },
      ],
    });

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByRole('button', { name: 'Scan for Payments' }).click();

    // Verify detected payment
    await expect(page.getByText('1 transfer found')).toBeVisible();
    await expect(page.getByText(matchedStealthAddress)).toBeVisible();
    await expect(page.getByText('100 XLM')).toBeVisible();

    // Click "Reveal secret key"
    await page.getByRole('button', { name: 'Reveal secret key' }).click();
    await expect(page.getByText('Stealth Key', { exact: true })).toBeVisible();
  });

  test('Receive - 15. Successfully withdraws funds from a detected stealth payment', async ({
    page,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    const matchedStealthAddress = 'GAL77LMANDOA32MTLU3GG3Z22G2543PDIE5REOEOIU5QL4VEYHJ5WKON';

    await freighter.mock({ isConnected: true, address: mockAddress });
    await horizon.mock({
      accountExists: true,
      accountBalance: '250',
      txSuccess: true,
      txHash: 'tx_withdrawal_hash_987654',
      sorobanEvents: [
        {
          schemeId: 1,
          stealthAddress: matchedStealthAddress,
          caller: mockAddress,
          ephemeralPubKey: new Uint8Array(32),
          viewTag: 123,
        },
      ],
    });

    await page.goto('/receive');
    await page.selectOption('select', 'stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByRole('button', { name: 'Scan for Payments' }).click();

    // Fill destination and withdraw
    await page.getByPlaceholder('Destination address (G...)').fill(mockAddress);
    await page.getByRole('button', { name: 'Withdraw' }).click();

    // Confirm withdrawal transaction success
    await expect(page.getByText('Withdrawn —')).toBeVisible();
    await expect(page.getByText('tx_withdrawal')).toBeVisible();
  });
});
