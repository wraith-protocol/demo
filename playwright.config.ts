import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const args = process.argv.slice(2);
const requestedProjects = args
  .flatMap((arg, index) => {
    if (arg === '--project') return [args[index + 1] ?? ''];
    if (arg.startsWith('--project=')) return [arg.slice('--project='.length)];
    return [];
  })
  .filter(Boolean);

const pwaOnly =
  Boolean(process.env.PWA_TEST_ONLY) ||
  (requestedProjects.length > 0 && requestedProjects.every((project) => project.includes('pwa')));
const startDevServer =
  !pwaOnly &&
  (requestedProjects.length === 0 ||
    requestedProjects.some(
      (project) => !project.includes('pwa') && !project.startsWith('chromium-'),
    ));
const startPreviewServer =
  pwaOnly ||
  requestedProjects.length === 0 ||
  requestedProjects.some((project) => project.includes('pwa') || project.startsWith('chromium-'));
const startPwaUpdateServer =
  pwaOnly ||
  requestedProjects.length === 0 ||
  requestedProjects.some((project) => project.includes('pwa'));

export default defineConfig({
  testDir: '.',
  testMatch: ['**/tests/**/*.spec.ts', '**/e2e/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
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
        baseURL: 'http://127.0.0.1:5174',
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 720 },
      },
      testMatch: ['**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        baseURL: 'http://127.0.0.1:5174',
        serviceWorkers: 'block',
        viewport: { width: 375, height: 667 },
      },
      testMatch: ['**/e2e/visual-*.spec.ts'],
    },
    {
      name: 'chromium-tablet',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5174',
        serviceWorkers: 'block',
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
    // PWA tests require a production build (the SW is disabled in dev mode).
    // They run only on Chromium, which has the most complete SW + Cache API
    // support required for the offline-reload scenario.
    {
      name: 'pwa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5174',
      },
      testMatch: ['**/e2e/pwa-*.spec.ts'],
    },
  ],
  webServer: [
    ...(startDevServer
      ? [
          {
            command: 'pnpm dev',
            url: 'http://127.0.0.1:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
    ...(startPreviewServer
      ? [
          {
            // The pwa-chromium project points at the preview server. The build must
            // have run before `playwright test` is invoked (pnpm build && pnpm test).
            command: 'pnpm preview --port 5174 --host 127.0.0.1',
            url: 'http://127.0.0.1:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          ...(startPwaUpdateServer
            ? [
                {
                  command: 'node e2e/pwa-update-server.mjs',
                  url: 'http://127.0.0.1:5178',
                  reuseExistingServer: false,
                  timeout: 120_000,
                },
              ]
            : []),
        ]
      : []),
  ],
});
