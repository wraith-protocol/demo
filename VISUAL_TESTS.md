# Visual Regression Testing

This document describes the visual regression testing setup for the Wraith Protocol demo.

## Overview

Visual regression tests capture screenshots of critical transaction states across all supported chains (Horizen, Stellar, Solana, CKB) to detect UI regressions that functional tests might miss, such as:

- Clipped addresses or text
- Overlapping controls
- Invisible error messages
- Broken mobile layouts
- Theme regressions

## Test Coverage

### Horizen (EVM)

- **Send Page**: Not connected, empty form, recipient filled, wraith name, amount filled, max amount, invalid input error, pending transaction, success state
- **Receive Page**: Not connected, derive keys, meta address displayed, registration pending, registration complete, scan button, scanning state, no transfers found, payment found, withdraw form, withdrawing state, withdrawn, private key revealed

### Stellar

- **Send Page**: Not connected, form filled, success state
- **Receive Page**: Not connected, meta address displayed, payment found

### Solana

- **Send Page**: Not connected, form filled, success state
- **Receive Page**: Not connected, meta address displayed, payment found

### CKB

- **Send Page**: Not connected, form filled, stealth cell generated
- **Receive Page**: Not connected, meta address displayed, stealth cell found

### Error States

- Invalid meta-address error
- Name not found error
- Insufficient balance error
- Transaction failed error
- Wallet connection error

### Viewports

- Desktop: 1280x720
- Mobile: 375x667
- Tablet: 768x1024

## Running Tests

### Initial Setup

Install Playwright browsers:

```bash
npx playwright install --with-deps
```

### Run All Visual Tests

```bash
pnpm test:visual
```

### Run Visual Tests in UI Mode

```bash
pnpm test:e2e:ui
```

### Update Baseline Screenshots

After intentional UI changes, update the baseline screenshots:

```bash
pnpm test:visual:update
```

### Run Specific Test File

```bash
npx playwright test e2e/horizen-send.spec.ts
```

### Run With Specific Browser

```bash
npx playwright test --project=chromium-desktop
npx playwright test --project=firefox-desktop
npx playwright test --project=webkit-desktop
```

## Test Structure

### Fixtures (`e2e/fixtures.ts`)

Deterministic fixtures for test isolation:

- `mockTime`: Fixed date (2025-01-15T12:00:00.000Z) to avoid time-dependent UI changes
- `mockBalances`: Fixed balances for all chains
- `mockNetworkResponses`: Mocked RPC responses for deterministic network behavior

### Test Files

Each chain has dedicated test files (prefixed with `visual-` to distinguish from functional tests):

- `e2e/visual-horizen-send.spec.ts` - Horizen send states
- `e2e/visual-horizen-receive.spec.ts` - Horizen receive states
- `e2e/visual-stellar-send.spec.ts` - Stellar send states
- `e2e/visual-stellar-receive.spec.ts` - Stellar receive states
- `e2e/visual-solana-send.spec.ts` - Solana send states
- `e2e/visual-solana-receive.spec.ts` - Solana receive states
- `e2e/visual-ckb-send.spec.ts` - CKB send states
- `e2e/visual-ckb-receive.spec.ts` - CKB receive states
- `e2e/visual-error-states.spec.ts` - Error state coverage

### Configuration (`playwright.config.ts`)

- Reduced motion enabled for all tests
- Animations disabled in screenshots
- Multiple viewport configurations
- Preview server for built application
- Artifact storage for test results

## Deterministic Behavior

Tests ensure deterministic rendering by:

1. **Freezing Time**: All tests use a fixed timestamp
2. **Mocking Network Responses**: RPC calls return predictable data
3. **Masking Dynamic Data**: Addresses, hashes, and private keys use consistent mock values
4. **Reduced Motion**: Animations are disabled to avoid timing issues
5. **Fixed Fonts**: System fonts are used with consistent rendering

## CI Integration

Visual tests run automatically on pull requests via GitHub Actions:

1. Build the application
2. Install Playwright browsers
3. Run visual tests against the built preview
4. Upload test results and screenshots as artifacts
5. Failed tests trigger CI failure

## Reviewing Failures

When a visual test fails:

1. Download the `visual-test-results` artifact from the failed CI run
2. Open `playwright-report/index.html` to view the comparison
3. Compare baseline vs. actual screenshots
4. If the change is intentional, run `npm run test:visual:update` locally
5. Commit the updated screenshots

## Adding New Tests

To add visual coverage for a new state:

1. Add a test case to the appropriate spec file
2. Set up the page state (inputs, mocks, chain selection)
3. Call `await expect(page).toHaveScreenshot('descriptive-name.png')`
4. Run the test once to generate the baseline
5. Commit the new screenshot

### Example

```typescript
test('new transaction state', async ({ page }) => {
  await page.goto('/send');
  await page.evaluate(() => {
    (window as any).mockTransactionState = 'new-state';
  });
  await expect(page).toHaveScreenshot('horizen-send-new-state.png');
});
```

## Best Practices

1. **Descriptive Names**: Use clear, descriptive screenshot names
2. **Minimal Changes**: Each test should change only what's necessary
3. **Wait for Stability**: Use `waitForLoadState('networkidle')` before screenshots
4. **Mask Secrets**: Never commit real addresses, keys, or hashes
5. **Viewport Coverage**: Test critical states on mobile and desktop
6. **Error States**: Don't forget error and edge case states

## Troubleshooting

### Screenshots differ due to font rendering

Font rendering can vary across platforms. If this causes false positives:

- Use the same OS for baseline generation and CI (Ubuntu)
- Consider using system fonts consistently

### Tests timeout

Increase timeout in `playwright.config.ts`:

```typescript
use: {
  actionTimeout: 10000,
  navigationTimeout: 30000,
}
```

### Flaky tests due to animations

Ensure `reducedMotion: 'reduce'` is set in config and tests call `emulateMedia` before screenshots.

## References

- [Playwright Visual Regression](https://playwright.dev/docs/web-shots)
- [Playwright Configuration](https://playwright.dev/docs/test-configuration)
