import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const MIDNIGHT_BG = '#1b1b25';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/main.tsx via virtual:pwa-register
      manifest: {
        name: 'Media Tracker',
        short_name: 'Media Tracker',
        description: 'Track and rate the anime, movies, TV, music, games and books you love.',
        theme_color: MIDNIGHT_BG,
        background_color: MIDNIGHT_BG,
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell (JS, CSS, HTML, fonts, icons).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Nothing is runtime-cached: /api/* always goes to the network (the app keeps its own
        // offline copy in IndexedDB), and covers load from their hosts.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
