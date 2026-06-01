import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * The notification service worker and scan web worker are bundled as separate
 * entry points so they can run in their own execution contexts.
 *
 * vite-plugin-pwa is optional — if it isn't installed the SW can still be
 * served from public/ as a pre-built file (see scripts/build-sw.sh).
 * We use injectManifest mode so we control the full SW source.
 */

let pwaPlugin: ReturnType<typeof import('@vite-pwa/assets-generator')['VitePWA']> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VitePWA } = require('vite-plugin-pwa');
  pwaPlugin = VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src/sw',
    filename: 'stellar-notification-sw.ts',
    outDir: 'dist',
    injectManifest: {
      swDest: 'dist/stellar-notification-sw.js',
    },
    manifest: false, // managed manually via index.html
  });
} catch {
  // vite-plugin-pwa not installed — SW served from public/ as a static file
}

export default defineConfig({
  plugins: [react(), ...(pwaPlugin ? [pwaPlugin] : [])],
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
  // Bundle the scan worker as a separate IIFE chunk served from /public
  worker: {
    format: 'iife',
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'stellar-scan-worker': path.resolve(
          __dirname,
          'src/workers/stellar-scan-worker.ts',
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'stellar-scan-worker'
            ? '[name].js' // output to dist root so SW can fetch /stellar-scan-worker.js
            : 'assets/[name]-[hash].js',
      },
    },
  },
});