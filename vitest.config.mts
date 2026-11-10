// ==========================================================================
// Quandle GitHub Action · vitest.config.mts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Test runner config: every test lives in test/, and src/ must stay at 100% coverage
// (lines, branches, functions, statements). Coverage below that fails npm run all and CI.
// ==========================================================================
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only wires the real @actions runtime; types.ts has no runtime code.
      exclude: ['src/index.ts', 'src/types.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
