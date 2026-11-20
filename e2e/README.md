# Playwright E2E Test Suite

This directory contains the end-to-end (E2E) integration test suite for the Wraith Protocol Demo app, specifically focusing on Stellar stealth payments.

## Directory Structure

```
e2e/
├── fixtures.ts     # Shared test fixtures (mocked Freighter, mocked Horizon, mocked Soroban RPC)
├── stellar.spec.ts # Stellar E2E scenarios
└── README.md       # This documentation
```

## Running Tests

First, install the Playwright browser binaries:

```bash
pnpm playwright install
```

### Run all tests (headless, all browsers)

```bash
pnpm test:e2e
```

### Run tests in interactive UI mode

This starts the Playwright test runner UI, enabling step-by-step visual debugging:

```bash
pnpm test:e2e:ui
```

### Debug a specific test

```bash
pnpm playwright test e2e/stellar.spec.ts --project=chromium --debug
```

---

## How It Works (Mocking Architecture)

Since interacting with real wallet extensions (like Freighter) and testnet contracts can be slow and unpredictable, we use a completely local, deterministic mocking architecture defined in `e2e/fixtures.ts`.

### 1. Mocking Freighter Wallet (`freighter` fixture)

The E2E suite updates `src/context/StellarWalletContext.tsx` to check for `window.freighterMock`. If present, it uses this mock instead of dynamically importing `@stellar/freighter-api`.

In your spec, configure the mock wallet:

```typescript
await freighter.mock({
  isConnected: true,
  address: 'GDTESTING...',
  signedMessage: '...', // Mock signature payload (base64)
});
```

### 2. Mocking Network Calls (`horizon` fixture)

The `horizon` fixture intercepts HTTP requests made by the page:

- `GET https://horizon-testnet.stellar.org/accounts/*` maps to your configured balance/sequence.
- `POST https://horizon-testnet.stellar.org/transactions` returns successful or failed transaction responses.
- `POST https://soroban-testnet.stellar.org` intercepts Soroban JSON-RPC calls, resolving contract states and simulate/send/get transactions.

In your spec:

```typescript
await horizon.mock({
  accountExists: true,
  accountBalance: '500',
  txSuccess: true,
  txHash: 'tx_hash_123',
});
```

To mock custom contract announcements (e.g. stealth address events), pass them under `sorobanEvents`:

```typescript
await horizon.mock({
  sorobanEvents: [
    {
      schemeId: 1,
      stealthAddress: 'GDQ...',
      caller: 'GDT...',
      ephemeralPubKey: new Uint8Array(32),
      viewTag: 123,
    },
  ],
});
```

---

## How to Add a New Spec

1. **Create a spec file**: Add a new file `e2e/your-feature.spec.ts`.
2. **Import test and expect**: Use the custom fixtures:
   ```typescript
   import { test, expect } from './fixtures';
   ```
3. **Write the test structure**:

   ```typescript
   test.describe('My Feature E2E Suite', () => {
     test('Scenario title', async ({ page, freighter, horizon }) => {
       // 1. Mock wallet and network state
       await freighter.mock({ isConnected: true });
       await horizon.mock({ accountBalance: '100' });

       // 2. Perform page interactions
       await page.goto('/send');
       // ...

       // 3. Assert states
       await expect(page.getByText('Success')).toBeVisible();
     });
   });
   ```

4. **Register or run**: Playwright automatically finds any files ending in `.spec.ts` in the `e2e/` folder.
