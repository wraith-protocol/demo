# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: stellar-receive.spec.ts >> StellarReceive Virtualization and Filtering >> virtualizes matches, supports lazy fetching, and filters correctly
- Location: tests/stellar-receive.spec.ts:6:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /Derive Keys/i })

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - banner [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - link "Wraith Wraith Demo" [ref=e8] [cursor=pointer]:
          - /url: /send
          - img "Wraith" [ref=e9]
          - generic [ref=e10]: Wraith
          - generic [ref=e11]: Demo
        - navigation [ref=e12]:
          - link "Send" [ref=e13] [cursor=pointer]:
            - /url: /send
          - link "Receive" [ref=e14] [cursor=pointer]:
            - /url: /receive
      - generic [ref=e15]:
        - generic [ref=e16]:
          - combobox [ref=e17]:
            - option "Horizen" [selected]
            - option "Stellar"
            - option "Solana"
            - option "CKB"
          - generic:
            - img
        - button "Connect Wallet" [ref=e19] [cursor=pointer]
  - main [ref=e20]:
    - generic [ref=e21]:
      - generic [ref=e22]: Horizen Testnet / ETH
      - heading "Receive" [level=1] [ref=e23]
      - paragraph [ref=e24]: Connect your wallet to scan for incoming stealth transfers on Horizen.
```

# Test source

```ts
  12  |       window.freighter = {
  13  |         isConnected: async () => ({ isConnected: true }),
  14  |         isAllowed: async () => ({ isAllowed: true }),
  15  |         getUserInfo: async () => ({ publicKey: address }),
  16  |         getPublicKey: async () => address,
  17  |         getAddress: async () => ({ address: address }),
  18  |         requestAccess: async () => {},
  19  |         signMessage: async () => {
  20  |           // Return a 64-byte signature (all 1s)
  21  |           return new Uint8Array(64).fill(1);
  22  |         },
  23  |         signTransaction: async () => 'mock-tx'
  24  |       };
  25  |     }, callerAddressStr);
  26  | 
  27  |     // Generate keys based on the mock signature
  28  |     const signature = new Uint8Array(64).fill(1);
  29  |     const keys = deriveStealthKeys(signature);
  30  | 
  31  |     // Generate 35 mock events
  32  |     const mockEvents = [];
  33  |     const mockBalances = new Map();
  34  |     
  35  |     for (let i = 0; i < 35; i++) {
  36  |       const generated = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
  37  |       
  38  |       const stealthAddressScVal = new Address(generated.stealthAddress).toScVal();
  39  |       const schemeIdScVal = xdr.ScVal.scvU32(1);
  40  |       
  41  |       const callerScVal = new Address(callerAddressStr).toScVal();
  42  |       const ephPubKeyScVal = xdr.ScVal.scvBytes(Buffer.from(generated.ephemeralPubKey));
  43  |       const metadataScVal = xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))); // 32 empty bytes
  44  |       
  45  |       const valueVec = [callerScVal, ephPubKeyScVal, metadataScVal];
  46  |       const valueScVal = xdr.ScVal.scvVec(valueVec);
  47  | 
  48  |       mockEvents.push({
  49  |         topic: [
  50  |           'AAAAAQAAA...mock', // Event name (not parsed deeply)
  51  |           schemeIdScVal.toXDR('base64'),
  52  |           stealthAddressScVal.toXDR('base64')
  53  |         ],
  54  |         value: valueScVal.toXDR('base64')
  55  |       });
  56  |       
  57  |       // Assign balances 1.5, 2.5, ..., 35.5
  58  |       mockBalances.set(generated.stealthAddress, `${i + 1}.5`);
  59  |     }
  60  | 
  61  |     // Mock the getEvents RPC call
  62  |     await page.route('**/rpc', async (route) => {
  63  |       const req = route.request();
  64  |       if (req.method() === 'POST') {
  65  |         const postData = req.postDataJSON();
  66  |         if (postData?.method === 'getEvents') {
  67  |           await route.fulfill({
  68  |             json: {
  69  |               jsonrpc: '2.0',
  70  |               id: postData.id,
  71  |               result: {
  72  |                 events: mockEvents,
  73  |                 latestLedger: 1000,
  74  |               }
  75  |             }
  76  |           });
  77  |           return;
  78  |         }
  79  |       }
  80  |       await route.continue();
  81  |     });
  82  | 
  83  |     // Mock Horizon accounts call for balances
  84  |     await page.route('**/accounts/*', async (route) => {
  85  |       const url = route.request().url();
  86  |       const match = url.match(/\/accounts\/(G[A-Z0-9]+)/);
  87  |       if (match) {
  88  |         const address = match[1];
  89  |         const balance = mockBalances.get(address) || '0';
  90  |         await route.fulfill({
  91  |           json: {
  92  |             id: address,
  93  |             account_id: address,
  94  |             sequence: "1",
  95  |             balances: [
  96  |               {
  97  |                 balance,
  98  |                 asset_type: "native"
  99  |               }
  100 |             ]
  101 |           }
  102 |         });
  103 |         return;
  104 |       }
  105 |       await route.continue();
  106 |     });
  107 | 
  108 |     // Go to the Receive page
  109 |     await page.goto('/receive');
  110 | 
  111 |     // Wait for Stellar Wallet Context and derive keys
> 112 |     await page.getByRole('button', { name: /Derive Keys/i }).click();
      |                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  113 | 
  114 |     // Scan for payments
  115 |     await page.getByRole('button', { name: /Scan for Payments/i }).click();
  116 | 
  117 |     // Verify 35 transfers found
  118 |     await expect(page.getByText('35 transfers found')).toBeVisible();
  119 | 
  120 |     // Check virtualization: only a subset should be visible initially (25 based on logic, plus overscan)
  121 |     // We can count how many rows are currently in the DOM
  122 |     const rowLocator = page.locator('text=Stealth Address');
  123 |     const initialCount = await rowLocator.count();
  124 |     
  125 |     // Virtualizer only renders visible + overscan, so it should be < 35
  126 |     expect(initialCount).toBeLessThan(35);
  127 |     expect(initialCount).toBeGreaterThan(0);
  128 |     
  129 |     // Check lazy load balance - at least one balance like "1.5 XLM" is visible
  130 |     await expect(page.getByText('1.5 XLM')).toBeVisible();
  131 | 
  132 |     // Scroll down to the bottom of the virtualized container
  133 |     const container = page.locator('.max-h-\\[600px\\]');
  134 |     await container.evaluate((el) => {
  135 |       el.scrollTop = el.scrollHeight;
  136 |     });
  137 | 
  138 |     // Wait for the new items to render and fetch
  139 |     await page.waitForTimeout(1000);
  140 |     
  141 |     // We should see items from the bottom of the list like 25.5 (if 25 is max)
  142 |     await expect(page.getByText('25.5 XLM')).toBeVisible();
  143 |     
  144 |     // Click 'Show 25 more'
  145 |     await page.getByRole('button', { name: /Show 25 more/i }).click();
  146 | 
  147 |     // Scroll down again
  148 |     await container.evaluate((el) => {
  149 |       el.scrollTop = el.scrollHeight;
  150 |     });
  151 |     
  152 |     // Now we should see the last item "35.5 XLM"
  153 |     await page.waitForTimeout(1000);
  154 |     await expect(page.getByText('35.5 XLM')).toBeVisible();
  155 | 
  156 |     // Test filtering by amount
  157 |     const searchInput = page.getByPlaceholder('Search by address or amount...');
  158 |     await searchInput.fill('35.5');
  159 |     
  160 |     // Should filter down to exactly 1 match
  161 |     await expect(page.getByText('35.5 XLM')).toBeVisible();
  162 |     await expect(page.getByText('1.5 XLM')).not.toBeVisible();
  163 |   });
  164 | });
  165 | 
```