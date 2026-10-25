import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by CI to "/<repo>/" for GitHub Pages; "./" keeps local builds relocatable.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // spec 6.6: update only when the player chooses
      manifest: {
        name: 'SYSTEM', short_name: 'SYSTEM', display: 'standalone',
        start_url: './', scope: './', background_color: '#03060f', theme_color: '#03060f',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'] },
    }),
  ],
  test: { environment: 'node', exclude: ['tests/browser/**', 'node_modules/**'] },
});
