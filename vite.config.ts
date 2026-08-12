import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/group-money-counter/
const BASE = '/group-money-counter/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Group Money Counter',
        short_name: 'Counter',
        description:
          'A shared expense ledger that stays on your device. No account, no server, no network.',
        theme_color: '#1B4D33',
        background_color: '#FBFCF9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Everything ships in the bundle; nothing is ever fetched at runtime.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm}'],
        navigateFallback: `${BASE}index.html`,
        // Fold the Workbox runtime into sw.js instead of pulling it in with
        // importScripts, and drop its debug logging. Both exist to keep
        // scripts/check-offline.mjs meaningful: the fewer network-shaped
        // constructs in the bundle, the fewer exceptions the check needs.
        inlineWorkboxRuntime: true,
        mode: 'production',
      },
    }),
  ],
  build: {
    // No dynamic imports, and every target browser supports modulepreload
    // natively. The polyfill's only job is fetching same-origin chunks, but
    // shipping zero fetch() calls is worth more than it costs.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
