import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { VitePWA } from 'vite-plugin-pwa';
import { extractInitialLoadPaths } from './scripts/initial-load-paths.mjs';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  plugins: [
    react(),
    VitePWA({
      // Use 'injectManifest' so our custom SW (app-sw.ts) controls precaching and runtime
      // caching. The custom SW merges PWA precache + Stellar notification background sync.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'app-sw.ts',
      outDir: 'dist',

      manifest: {
        name: 'Wraith Demo — Stealth Address SDK',
        short_name: 'Wraith',
        description:
          'Developer demo for the Wraith Protocol stealth address SDK. Send and receive private payments on Horizen and Stellar.',
        start_url: '/send',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#0e0e0e',
        background_color: '#0e0e0e',
        lang: 'en',
        categories: ['finance', 'utilities'],
        share_target: {
          action: '/send',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: { text: 'text' },
        },
        icons: [
          { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/og-image.png',
            sizes: '1200x630',
            type: 'image/png',
            label: 'Wraith Demo — Send and Receive',
            // @ts-expect-error – form_factor is valid but not yet in typedefs
            form_factor: 'wide',
          },
        ],
      },

      manifestFilename: 'manifest.webmanifest',
      // 'prompt' registers the worker without calling skipWaiting, so a waiting
      // update is surfaced to the user instead of swapping the app underneath
      // them. `injectRegister: null` disables the auto-injected register script;
      // registration happens in src/hooks/useAppUpdate.ts via
      // `virtual:pwa-register` so the prompt is driven by app state.
      registerType: 'prompt',
      injectRegister: null,

      // injectManifest config: controls what gets injected into self.__WB_MANIFEST
      injectManifest: {
        // Precache only the application shell: HTML, critical CSS, web manifest,
        // and app icons. JS chunks (route chunks, chain SDKs), images, and fonts
        // are left for bounded runtime caches in app-sw.ts.
        //
        // The critical bootstrap JS (referenced directly from index.html) is
        // deterministically identified via manifestTransforms below so only the
        // true bootstrap is precached, avoiding broad globs that capture heavy
        // vendor or route chunks.
        globPatterns: [
          'index.html',
          'assets/*.css',
          'favicon.ico',
          'favicon-*.png',
          'apple-touch-icon.png',
          'manifest.webmanifest',
        ],
        // app-sw.ts is the service worker itself, not a prefetchable asset.
        globIgnores: ['**/app-sw*', '**/stellar-notification-sw*'],
        // Deterministically include only the critical bootstrap / app shell JS
        // referenced synchronously from dist/index.html.
        manifestTransforms: [
          async (manifestEntries) => {
            const htmlPath = path.resolve(__dirname, 'dist/index.html');
            const html = await fs.promises.readFile(htmlPath, 'utf8');
            const initialPaths = extractInitialLoadPaths(html);

            for (const initialPath of initialPaths) {
              const relPath = initialPath.replace(/^\/+/, '');
              if (manifestEntries.some((entry) => entry.url === relPath)) continue;

              const fullPath = path.resolve(__dirname, 'dist', relPath);
              try {
                const fileStat = await fs.promises.stat(fullPath);
                manifestEntries.push({
                  url: relPath,
                  revision: null, // Vite hashes filenames for cache-busting
                  size: fileStat.size,
                });
              } catch {
                // Ignore missing files
              }
            }

            return { manifest: manifestEntries };
          },
        ],
      },

      devOptions: {
        enabled: false, // Do not activate SW in dev (avoids stale cache confusion)
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      buffer: 'buffer',
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
