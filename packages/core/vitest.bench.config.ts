import { defineConfig } from 'vitest/config';

// Timings, not tests: kept out of `pnpm test` so CI stays quick and never fails on a slow runner.
export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Memory rows collect garbage first, so they count only what is kept.
    execArgv: ['--expose-gc'],
  },
});
