/**
 * vite.config.ts
 *
 * Extended for the push-notifications feature:
 *   • Aliases @/ → src/
 *   • Polyfills buffer/global for Stellar SDK
 *   • Bundles stellar-scan-worker.ts as a separate IIFE so the SW can
 *     `new Worker('/stellar-scan-worker.js')` it
 *   • Optionally integrates vite-plugin-pwa (injectManifest mode) when the
 *     package is installed; falls back to the pre-built public/ assets
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';

// vite-plugin-pwa is optional — the SW can be served from public/ directly.
function tryLoadPwa(): Plugin | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VitePWA } = require('vite-plugin-pwa');
    return VitePWA({
      strategies:        'injectManifest',
      srcDir:            'src/sw',
      filename:          'stellar-notification-sw.ts',
      outDir:            'dist',
      injectManifest:    { swDest: 'dist/stellar-notification-sw.js' },
      // We manage the web manifest ourselves (public/manifest.json + index.html link).
      manifest:          false,
    }) as Plugin;
  } catch {
    return null;
  }
}

const pwaPlugin = tryLoadPwa();

export default defineConfig({
  plugins: [react(), ...(pwaPlugin ? [pwaPlugin] : [])],

  resolve: {
    alias: {
      '@':     path.resolve(__dirname, 'src'),
      buffer:  'buffer',
    },
  },

  define: {
    // Stellar SDK expects a Node.js-style global
    global: 'globalThis',
  },

  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' } },
  },

  // Workers in Vite are bundled as IIFE by default, which is what we want
  // for /stellar-scan-worker.js (needs to run without module support in SW).
  worker: { format: 'iife' },

  build: {
    rollupOptions: {
      input: {
        main:                   path.resolve(__dirname, 'index.html'),
        // Output: dist/stellar-scan-worker.js — fetched by the SW at runtime
        'stellar-scan-worker':  path.resolve(__dirname, 'src/workers/stellar-scan-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'stellar-scan-worker'
            ? '[name].js'               // no hash — SW needs a stable URL
            : 'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },
  },
});