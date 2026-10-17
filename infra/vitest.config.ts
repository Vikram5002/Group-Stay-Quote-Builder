import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'infra',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Synthesising stacks bundles nothing (Lambda code comes from prebuilt assets) but is slow-ish.
    testTimeout: 60_000,
  },
});
