import { defineConfig } from 'vitest/config';
// Real-browser suite. Needs a Chromium: set CHROMIUM_PATH, or install Playwright's browser (`npx playwright-core install chromium`).
export default defineConfig({ test: { include: ['tests/browser/**/*.test.ts'], environment: 'node', testTimeout: 90_000, hookTimeout: 120_000, fileParallelism: false } });
