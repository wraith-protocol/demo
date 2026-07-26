/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// workbox-precaching injects the precache manifest at the __WB_MANIFEST injection point.
// Declare it here so TypeScript knows about it in the service worker source file.
declare const __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
