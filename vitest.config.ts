import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // The end-to-end specs are Playwright's, not Vitest's.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**'],
  },
});
