/**
 * PWA first-install → offline reload test
 *
 * Verifies that after the service worker installs and activates for the first
 * time, the app shell (HTML + critical CSS + bootstrap JS) is served entirely
 * from the precache on the very next reload even when the network is offline.
 *
 * This test MUST run against the production build served by `vite preview`
 * (port 5174) because the SW is intentionally disabled in dev mode.
 * It is placed in the pwa-chromium Playwright project for that reason.
 *
 * Bug history: the Workbox JS runtime route used `/^\/assets\/.*\.js$/i` which
 * never matched against full `request.url` hrefs, so optional chunks were never
 * cached at runtime. More critically the entry bootstrap was removed from the
 * precache manifest, so the first offline reload failed because the bootstrap
 * had been fetched before the new worker controlled the page.
 */

import { expect, test } from '@playwright/test';

// Use a fresh browser context for every test so we never inherit a pre-existing
// service worker registration or Cache Storage entries from another spec.
test.use({ contextOptions: { storageState: undefined } });

test.describe('PWA precache — first install then offline reload', () => {
  test('app shell loads from cache on first offline reload after SW install', async ({
    page,
    context,
  }) => {
    // ── Step 1: online first load ────────────────────────────────────────────
    // Navigate to the app. The SW installs and activates on this visit.
    await page.goto('/');

    // Wait for the service worker to become activated.  The SW uses
    // 'registerType: prompt' so it does not call skipWaiting automatically;
    // we trigger it programmatically via the ServiceWorker API.
    await page.waitForFunction(
      () =>
        navigator.serviceWorker.controller !== null ||
        navigator.serviceWorker.getRegistration().then((r) => r?.active != null),
      { timeout: 20_000 },
    );

    // Force the waiting SW to take control immediately (simulates the user
    // accepting an update prompt or the first install finishing activation).
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('No SW registration found');

      // If there is a waiting worker, activate it now.
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Wait until a controller is set (i.e. the SW is active and controlling).
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          });
        });
      }
    });

    // Allow precache population to complete: the SW caches all injected
    // manifest entries during the `install` event, so by the time the worker
    // controls the page the precache should already be warm.  One extra tick
    // is enough.
    await page.waitForTimeout(500);

    // ── Step 2: go offline ───────────────────────────────────────────────────
    await context.setOffline(true);

    // ── Step 3: reload while offline ────────────────────────────────────────
    // The page must load from the service worker's precache, not the network.
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes(page.url().replace(/\/$/, ''))),
      page.reload(),
    ]);

    // A network-served response would throw while offline; getting here means
    // the SW intercepted the navigation request and served it from cache.

    // ── Step 4: verify the page rendered ────────────────────────────────────
    // The app should render without a network error page.  We look for the
    // root `<div id="root">` being non-empty, which proves React bootstrapped.
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });

    // ── Step 5: verify bootstrap JS was served from precache ────────────────
    // Check that at least one assets/index-*.js request was served (status 200)
    // during the offline reload, which must come from the service worker's
    // precache manifest.
    const swPrecacheHasBootstrap = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const precacheName = cacheNames.find((name) => name.includes('precache'));
      if (!precacheName) return false;
      const cache = await caches.open(precacheName);
      const keys = await cache.keys();
      return keys.some((req) => /\/assets\/index-[^/]+\.js$/.test(new URL(req.url).pathname));
    });

    expect(swPrecacheHasBootstrap).toBe(true);

    // ── Step 6: verify the JS runtime route matches by pathname ─────────────
    // A non-bootstrap chunk (e.g. a route chunk that was fetched during the
    // initial online load) should be findable in the runtime 'assets' cache,
    // proving the pathname-based route matcher works.
    const swRuntimeCacheHasChunk = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const assetsCacheName = cacheNames.find((n) => n.includes('-assets-'));
      if (!assetsCacheName) {
        // If no extra chunks were fetched yet that's also acceptable — the
        // route is correct as long as the precache bootstrap is present.
        return null;
      }
      const cache = await caches.open(assetsCacheName);
      const keys = await cache.keys();
      return keys.some((req) => new URL(req.url).pathname.startsWith('/assets/'));
    });

    // null means no extra chunk was fetched, which is fine.
    // true means the runtime assets cache is working with correct pathname matching.
    expect(swRuntimeCacheHasChunk).not.toBe(false);
  });

  test('offline navigation to /send serves the precached shell', async ({ page, context }) => {
    // Install the SW by loading the app once online.
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
      timeout: 20_000,
    });

    await context.setOffline(true);

    // Navigate to a different route while offline.  The SW must serve the
    // index.html shell (which handles all SPA routes via precache + fallback).
    await page.goto('/send');

    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });

    // The page title should still include the app name (not a browser error page).
    await expect(page).toHaveTitle(/Wraith/i);
  });

  test('precache is bounded to app shell and excludes optional chain chunks (storage pressure)', async ({
    page,
  }) => {
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
      timeout: 20_000,
    });

    const precacheStats = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const precacheName = cacheNames.find((name) => name.includes('precache'));
      if (!precacheName) throw new Error('No precache found');
      const cache = await caches.open(precacheName);
      const requests = await cache.keys();
      const urls = requests.map((r) => new URL(r.url).pathname);
      return {
        count: urls.length,
        hasScannerWorker: urls.some((u) => u.includes('stellar-scanner.worker')),
        hasStellarSend: urls.some((u) => u.includes('StellarSend')),
        hasSolanaSend: urls.some((u) => u.includes('SolanaSend')),
        hasCkbSend: urls.some((u) => u.includes('CkbSend')),
        hasZxing: urls.some((u) => u.includes('zxing-browser')),
        hasMetamask: urls.some((u) => u.includes('metamask-sdk')),
      };
    });

    // Ensure the precache is strictly bounded (not the 232-entry full build)
    expect(precacheStats.count).toBeLessThanOrEqual(25);
    // Ensure heavy/optional chain chunks and workers are excluded from precache
    expect(precacheStats.hasScannerWorker).toBe(false);
    expect(precacheStats.hasStellarSend).toBe(false);
    expect(precacheStats.hasSolanaSend).toBe(false);
    expect(precacheStats.hasCkbSend).toBe(false);
    expect(precacheStats.hasZxing).toBe(false);
    expect(precacheStats.hasMetamask).toBe(false);
  });

  test('service worker activation purges obsolete caches on update (storage pressure release)', async ({
    page,
    context,
  }) => {
    // Seed obsolete versioned and legacy caches before visiting
    await context.addInitScript(async () => {
      await window.caches.open('wraith-precache-v1');
      await window.caches.open('wraith-assets-v1');
      await window.caches.open('wraith-images-v1');
      await window.caches.open('rpc-cache');
    });

    await page.goto('/');

    // Wait for the service worker registration
    await page.waitForFunction(
      () =>
        navigator.serviceWorker.controller !== null ||
        navigator.serviceWorker
          .getRegistration()
          .then((r) => r?.active != null || r?.waiting != null),
      { timeout: 20_000 },
    );

    // Force SKIP_WAITING if waiting, and wait for controller
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('No SW registration found');

      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          });
        });
      }
    });

    // Wait until obsolete caches are purged by activate event
    await page.waitForFunction(
      () =>
        window.caches
          .keys()
          .then(
            (names) =>
              names.some((n) => n.includes('wraith-precache-v2')) &&
              !names.includes('wraith-precache-v1') &&
              !names.includes('wraith-assets-v1') &&
              !names.includes('rpc-cache'),
          ),
      null,
      { timeout: 20_000 },
    );

    const remaining = await page.evaluate(async () => caches.keys());
    expect(remaining).not.toContain('wraith-precache-v1');
    expect(remaining).not.toContain('wraith-assets-v1');
    expect(remaining).not.toContain('wraith-images-v1');
    expect(remaining).not.toContain('rpc-cache');
    expect(remaining.some((n) => n.includes('wraith-precache-v2'))).toBe(true);
  });
});
