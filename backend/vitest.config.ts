import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15000,
    // These are integration tests against one shared, mutable Postgres
    // database (no per-test transactional isolation). Some assertions
    // (e.g. stats/summary's active_device_count) read global state, so
    // running test files in parallel makes them flaky by another file's
    // concurrent writes, not by a bug in the code under test.
    fileParallelism: false,
  },
});
