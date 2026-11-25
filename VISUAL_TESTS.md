# Visual Regression Testing

This document describes the visual regression testing setup for the Wraith Protocol demo.

## Overview

Visual regression tests capture deterministic UI states across all supported chains (Horizen, Stellar, Solana, CKB) to detect regressions that functional tests might miss, such as:

- Clipped addresses or text
- Overlapping controls
- Invisible error messages
- Broken mobile layouts
- Theme regressions

## Test Coverage

### Horizen (EVM)

- Send and receive disconnected states

### Stellar

- Send disconnected, form-filled, and successful transfer states
- Receive disconnected state

### Solana

- Send and receive disconnected states

### CKB

- Send and receive disconnected states

Transaction-success coverage is currently exercised through Stellar's actual send flow with deterministic Freighter and Horizon mocks. Other wallet-dependent states are not represented by assigning unused globals; add them only when tests can drive the app through its real handlers.

### Viewports

- Desktop: 1280x720
- Mobile: 375x667
- Tablet: 768x1024

## Running Tests

### Initial Setup

Build the app and install the Playwright browser used by the visual suite:

```bash
pnpm build
pnpm exec playwright install chromium
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
pnpm exec playwright test e2e/visual-stellar-send.spec.ts
```

### Run a Visual Viewport

```bash
pnpm exec playwright test --project=chromium-desktop
pnpm exec playwright test --project=chromium-mobile
pnpm exec playwright test --project=chromium-tablet
```

## Test Structure

### Fixtures (`e2e/visual-fixtures.ts`, `e2e/fixtures.ts`)

Deterministic fixtures for test isolation:

- Fixed date, reduced motion, and seeded randomness
- External network requests are blocked unless explicitly mocked
- Freighter and Horizon mocks from `e2e/fixtures.ts` drive Stellar's actual send flow

### Test Files

Each chain has dedicated test files (prefixed with `visual-` to distinguish them from functional tests):

- `e2e/visual-horizen-send.spec.ts` - Horizen send states
- `e2e/visual-horizen-receive.spec.ts` - Horizen receive states
- `e2e/visual-stellar-send.spec.ts` - Stellar send states
- `e2e/visual-stellar-receive.spec.ts` - Stellar receive states
- `e2e/visual-solana-send.spec.ts` - Solana send states
- `e2e/visual-solana-receive.spec.ts` - Solana receive states
- `e2e/visual-ckb-send.spec.ts` - CKB send states
- `e2e/visual-ckb-receive.spec.ts` - CKB receive states

### Configuration (`playwright.config.ts`)

- Reduced motion enabled for all tests
- Animations disabled in screenshots
- Multiple viewport configurations
- Preview server for built application
- Artifact storage for test results

## Deterministic Behavior

Tests ensure deterministic rendering by:

1. **Freezing Time**: All tests use a fixed timestamp
2. **Mocking Stellar Dependencies**: Freighter and Horizon return predictable responses
3. **Blocking External Requests**: Unmocked network calls cannot affect screenshots
4. **Reduced Motion**: Animations are disabled to avoid timing issues
5. **Pinned Platform**: Baselines and visual CI both use Windows

## CI Integration

Visual tests run automatically on pull requests via GitHub Actions:

1. Build the application
2. Install Playwright browsers
3. Run visual tests against the built preview on Windows, matching the baseline platform
4. Upload test results and screenshots as artifacts
5. Failed tests trigger CI failure

## Reviewing Failures

When a visual test fails:

1. Download the `visual-test-results` artifact from the failed CI run
2. Open `playwright-report/index.html` to view the comparison
3. Compare baseline vs. actual screenshots
4. If the change is intentional, run `pnpm test:visual:update` on Windows
5. Commit the updated screenshots

## Adding New Tests

To add visual coverage for a new state:

1. Add a test case to the appropriate spec file
2. Drive the state through the app's UI with real deterministic mocks where needed
3. Assert the intended state is visible before calling `toHaveScreenshot`
4. Run `pnpm test:visual:update` on Windows and inspect the generated images
5. Commit the reviewed screenshots with the test

### Example

```typescript
test('successful send', async ({ page, freighter, horizon }) => {
  await freighter.mock({ isConnected: true, address: MOCK_WALLET });
  await horizon.mock({ txSuccess: true, txHash: MOCK_TX_HASH });
  await page.goto('/send');
  await page.locator('select:not(#locale-switcher)').selectOption('stellar');
  await page.getByRole('button', { name: 'Connect Freighter' }).click();
  await page.getByPlaceholder('st:xlm:...').fill(RECIPIENT_META);
  await page.getByPlaceholder('0.0').fill('50');
  await page.getByRole('button', { name: 'Send Privately' }).click();
  await expect(page.getByText('Transfer Complete')).toBeVisible();
  await expect(page.getByText(MOCK_TX_HASH)).toBeVisible();
  await expect(page).toHaveScreenshot('stellar-send-success.png');
});
```

## Best Practices

1. **Descriptive Names**: Use clear, descriptive screenshot names
2. **Minimal Changes**: Each test should change only what's necessary
3. **Assert State**: Verify the expected UI state before taking a screenshot
4. **Use Fixtures**: Mock wallet and network boundaries, not application state
5. **Viewport Coverage**: Test critical states on mobile and desktop

## Troubleshooting

### Screenshots differ due to font rendering

Font rendering can vary across platforms. If this causes false positives:

- Use the same OS for baseline generation and CI (Windows)
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
