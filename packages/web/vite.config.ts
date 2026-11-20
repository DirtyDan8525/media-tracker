import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const MIDNIGHT_BG = '#1b1b25';

/** Preloads the Inter 500 file (list titles, buttons) so the first paint does not swap fonts. Its hashed name only exists after the build. */
const preloadInter500 = (): Plugin => ({
  name: 'preload-inter-500',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const file = Object.keys(ctx.bundle ?? {}).find((n) => /inter-latin-500-normal[^/]*\.woff2$/.test(n));
      if (!file) return undefined;
      return [{ tag: 'link', attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }];
    },
  },
});

export default defineConfig({
  plugins: [
    react(),
    preloadInter500(),
    VitePWA({
      registerType: 'autoUpdate',
      includeManifestIcons: false, // the glob below already precaches them (no duplicates)
      injectRegister: false, // registered in src/main.tsx via virtual:pwa-register
      manifest: {
        name: 'Media Tracker',
        short_name: 'Media Tracker',
        description: 'Track and rate the anime, movies, TV, music, games and books you love.',
        theme_color: MIDNIGHT_BG,
        background_color: MIDNIGHT_BG,
        id: '/',
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
        // /api/* must reach the network, never the SPA shell.
        navigateFallbackDenylist: [/^\/api\//],
        // Nothing is runtime-cached: /api/* always goes to the network (the app keeps its own
        // offline copy in IndexedDB), and covers load from their hosts.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        // Push and notification clicks (Phase 6b): public/push-sw.js, loaded into the generated worker.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
