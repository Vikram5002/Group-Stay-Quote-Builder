import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // Test against core source so tests never depend on a stale build.
    alias: {
      '@c32/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
