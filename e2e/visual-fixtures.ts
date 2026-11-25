import { test as base, expect } from './fixtures';

export const FROZEN_TIME = new Date('2025-01-15T12:00:00.000Z');
export const MOCK_WALLET = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
export const MOCK_TX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const RECIPIENT_META =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

export const test = base.extend<{ frozenEnvironment: void }>({
  frozenEnvironment: [
    async ({ page }, use) => {
      // Time: fix Date without freezing timers, so the app keeps running.
      await page.clock.setFixedTime(FROZEN_TIME);

      // Motion: the config sets reducedMotion; this is a second guarantee.
      await page.emulateMedia({ reducedMotion: 'reduce' });

      // Fonts: never hit Google Fonts, so only the container's fonts render.
      await page.route(/fonts\.(googleapis|gstatic)\.com|plausible\.io/, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      );
      // Consent: pre-decline analytics so the cookie banner never renders.
      await page.addInitScript(() => {
        try {
          localStorage.setItem('wraith-telemetry-consent', 'declined');
        } catch {}
      });
      // Network: abort every non-local request so nothing external can stall the load event.
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

      // Randomness: seeded PRNG so ephemeral keys (and so stealth addresses) repeat.
      await page.addInitScript(() => {
        let s = 123456789;
        const next = () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s & 0xff;
        };
        const original = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = ((arr: any) => {
          if (arr instanceof Uint8Array) {
            for (let i = 0; i < arr.length; i++) arr[i] = next();
            return arr;
          }
          return original(arr);
        }) as typeof crypto.getRandomValues;
      });

      await use();
    },
    { auto: true },
  ],
});

export { expect };
