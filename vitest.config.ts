import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'vmThreads', // one jsdom per worker instead of per file, each file still isolated

    globals: true,
    alias: { '\\.scss$': './test/styleMock.ts' },
    // The end-to-end specs are Playwright's, not Vitest's; agent worktrees hold copies of the repo.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**', '.claude/**'],
  },
});
