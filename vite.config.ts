import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const version = process.env.APP_VERSION ?? (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version; // APP_VERSION lets tests build a distinguishable second release

// BASE_PATH is set by CI to "/<repo>/" for GitHub Pages; "./" keeps local builds relocatable.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // spec 6.6: update only when the player chooses
      manifest: {
        id: './', name: 'SYSTEM: Solo Leveling System', short_name: 'SYSTEM', description: 'A local-first personal RPG: turn real quests into levels, ranks and rewards. Your data stays on this device.',
        display: 'standalone', orientation: 'any', lang: 'en', categories: ['productivity', 'games'], start_url: './', scope: './', background_color: '#03060f', theme_color: '#03060f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: { cacheId: 'sls-system', globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'], cleanupOutdatedCaches: true, navigateFallback: 'index.html' },
    }),
  ],
  test: { environment: 'node', exclude: ['tests/browser/**', 'node_modules/**'] },
});
