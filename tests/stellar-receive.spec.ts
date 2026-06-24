import { test, expect } from '@playwright/test';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import { deriveStealthKeys, generateStealthAddress, STEALTH_SIGNING_MESSAGE } from '@wraith-protocol/sdk/chains/stellar';

test.describe('StellarReceive Virtualization and Filtering', () => {
  test('virtualizes matches, supports lazy fetching, and filters correctly', async ({ page }) => {
    const callerKeypair = Keypair.random();
    const callerAddressStr = callerKeypair.publicKey();

    // We will intercept Freighter API to return a fixed signature
    await page.addInitScript((address) => {
      window.freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getUserInfo: async () => ({ publicKey: address }),
        getPublicKey: async () => address,
        getAddress: async () => ({ address: address }),
        requestAccess: async () => {},
        signMessage: async () => {
          // Return a 64-byte signature (all 1s)
          return new Uint8Array(64).fill(1);
        },
        signTransaction: async () => 'mock-tx'
      };
    }, callerAddressStr);

    // Generate keys based on the mock signature
    const signature = new Uint8Array(64).fill(1);
    const keys = deriveStealthKeys(signature);

    // Generate 35 mock events
    const mockEvents = [];
    const mockBalances = new Map();
    
    for (let i = 0; i < 35; i++) {
      const generated = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
      
      const stealthAddressScVal = new Address(generated.stealthAddress).toScVal();
      const schemeIdScVal = xdr.ScVal.scvU32(1);
      
      const callerScVal = new Address(callerAddressStr).toScVal();
      const ephPubKeyScVal = xdr.ScVal.scvBytes(Buffer.from(generated.ephemeralPubKey));
      const metadataScVal = xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))); // 32 empty bytes
      
      const valueVec = [callerScVal, ephPubKeyScVal, metadataScVal];
      const valueScVal = xdr.ScVal.scvVec(valueVec);

      mockEvents.push({
        topic: [
          'AAAAAQAAA...mock', // Event name (not parsed deeply)
          schemeIdScVal.toXDR('base64'),
          stealthAddressScVal.toXDR('base64')
        ],
        value: valueScVal.toXDR('base64')
      });
      
      // Assign balances 1.5, 2.5, ..., 35.5
      mockBalances.set(generated.stealthAddress, `${i + 1}.5`);
    }

    // Mock the getEvents RPC call
    await page.route('**/rpc', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const postData = req.postDataJSON();
        if (postData?.method === 'getEvents') {
          await route.fulfill({
            json: {
              jsonrpc: '2.0',
              id: postData.id,
              result: {
                events: mockEvents,
                latestLedger: 1000,
              }
            }
          });
          return;
        }
      }
      await route.continue();
    });

    // Mock Horizon accounts call for balances
    await page.route('**/accounts/*', async (route) => {
      const url = route.request().url();
      const match = url.match(/\/accounts\/(G[A-Z0-9]+)/);
      if (match) {
        const address = match[1];
        const balance = mockBalances.get(address) || '0';
        await route.fulfill({
          json: {
            id: address,
            account_id: address,
            sequence: "1",
            balances: [
              {
                balance,
                asset_type: "native"
              }
            ]
          }
        });
        return;
      }
      await route.continue();
    });

    // Go to the Receive page
    await page.goto('/receive');

    // Wait for Stellar Wallet Context and derive keys
    await page.getByRole('button', { name: /Derive Keys/i }).click();

    // Scan for payments
    await page.getByRole('button', { name: /Scan for Payments/i }).click();

    // Verify 35 transfers found
    await expect(page.getByText('35 transfers found')).toBeVisible();

    // Check virtualization: only a subset should be visible initially (25 based on logic, plus overscan)
    // We can count how many rows are currently in the DOM
    const rowLocator = page.locator('text=Stealth Address');
    const initialCount = await rowLocator.count();
    
    // Virtualizer only renders visible + overscan, so it should be < 35
    expect(initialCount).toBeLessThan(35);
    expect(initialCount).toBeGreaterThan(0);
    
    // Check lazy load balance - at least one balance like "1.5 XLM" is visible
    await expect(page.getByText('1.5 XLM')).toBeVisible();

    // Scroll down to the bottom of the virtualized container
    const container = page.locator('.max-h-\\[600px\\]');
    await container.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Wait for the new items to render and fetch
    await page.waitForTimeout(1000);
    
    // We should see items from the bottom of the list like 25.5 (if 25 is max)
    await expect(page.getByText('25.5 XLM')).toBeVisible();
    
    // Click 'Show 25 more'
    await page.getByRole('button', { name: /Show 25 more/i }).click();

    // Scroll down again
    await container.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    
    // Now we should see the last item "35.5 XLM"
    await page.waitForTimeout(1000);
    await expect(page.getByText('35.5 XLM')).toBeVisible();

    // Test filtering by amount
    const searchInput = page.getByPlaceholder('Search by address or amount...');
    await searchInput.fill('35.5');
    
    // Should filter down to exactly 1 match
    await expect(page.getByText('35.5 XLM')).toBeVisible();
    await expect(page.getByText('1.5 XLM')).not.toBeVisible();
  });
});
