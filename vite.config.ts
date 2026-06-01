import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // prompt user before activating new SW
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'og-image.png'],
      manifest: {
        name: 'Wraith Demo',
        short_name: 'Wraith',
        description:
          'Developer demo for the Wraith Protocol stealth address SDK. Send and receive private payments on Horizen and Stellar.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0e0e0e',
        theme_color: '#0e0e0e',
        icons: [
          {
            src: '/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cap total cache at 20 MB
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Never cache anything that looks like a key or signed tx
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Google Fonts — cache-first, long TTL
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Stellar RPC balance lookups — network-first, 30 s TTL
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('stellar') ||
              url.hostname.includes('horizon') ||
              url.pathname.includes('/accounts/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'stellar-rpc-balance',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Stellar announcement / event streams — network-first, 5 min TTL
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('stellar') && url.pathname.includes('/transactions'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'stellar-rpc-announcements',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // EVM / Horizen RPC — network-first, no persistent cache (state changes)
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('horizen') ||
              url.hostname.includes('eon') ||
              (url.pathname === '/' && url.port !== ''),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'evm-rpc',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 20, maxAgeSeconds: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // keep dev fast; SW only active in production build
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
});
