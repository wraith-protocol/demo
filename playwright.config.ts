import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const isPwaOnly =
  process.argv.some((arg) => arg.includes('pwa-chromium') || arg.includes('pwa-')) ||
  Boolean(process.env.PWA_TEST_ONLY);

export default defineConfig({
  testDir: '.',
  testMatch: ['**/tests/**/*.spec.ts', '**/e2e/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/e2e/pwa-*.spec.ts', '**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: ['**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
      },
      testMatch: ['**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'chromium-tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
      testMatch: ['**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/e2e/pwa-*.spec.ts', '**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/e2e/pwa-*.spec.ts', '**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'pwa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5174',
      },
      testMatch: ['**/e2e/pwa-*.spec.ts'],
    },
  ],
  webServer: isPwaOnly
    ? [
        {
          command: 'pnpm preview --port 5174 --host 127.0.0.1',
          url: 'http://127.0.0.1:5174',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : [
        {
          command: 'pnpm dev',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'pnpm preview --port 5174 --host 127.0.0.1',
          url: 'http://127.0.0.1:5174',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
