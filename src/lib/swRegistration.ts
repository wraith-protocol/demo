/**
 * Access to the single service worker the app runs.
 *
 * The PWA worker in `src/sw/app-sw.ts` owns every background responsibility —
 * precaching, Stellar notification sync, viewing-key storage and push
 * subscriptions — and is registered once per page load by `useAppUpdate`
 * (`virtual:pwa-register`). Features that need to talk to it must reuse that
 * registration: registering a second script at the same scope replaces the
 * running worker, which used to leave the app with two competing scan paths and
 * two independent cursors.
 */
const REGISTRATION_TIMEOUT_MS = 10_000;

/**
 * Resolves the app's service worker registration, or `undefined` when the
 * browser has none (unsupported, or the worker is not registered yet). Waiting
 * is bounded so a disabled/updated-out worker can never hang the caller.
 */
export async function getAppServiceWorkerRegistration(
  timeoutMs = REGISTRATION_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;

  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    navigator.serviceWorker.ready.then(
      (registration) => {
        clearTimeout(timer);
        resolve(registration);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}
