import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/api'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/index.ts', 'apps/api/src/local.ts', 'apps/api/src/lambda.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        // Blueprint section 4.2: core at least 95% lines and 90% branches.
        'packages/core/src/**/*.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
    },
  },
});
