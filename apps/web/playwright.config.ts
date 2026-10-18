import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

/**
 * End-to-end tests run the real app in a browser against its built-in mock API, so they need no
 * backend. Set E2E_BASE_URL to run the same tests against a deployed environment instead.
 */
const externalBase = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  // A few browsers at a time: the dev server compiles on first load, and many at once starve it.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The full Chromium, so the smaller headless shell is not needed.
    // PW_CHANNEL=msedge uses the installed Edge instead of the downloaded Chromium.
    channel: process.env['PW_CHANNEL'] ?? 'chromium',
    baseURL: externalBase ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /responsive\.e2e\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /responsive\.e2e\.ts/ },
  ],
  ...(externalBase
    ? {}
    : {
        webServer: {
          // The production build with the mock API inside: nothing compiles on demand, so tests
          // are steady, and the build that ships is the one being tested.
          command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // Pinned so a developer's .env.local (real-API settings) never changes what the tests run against.
          env: { VITE_API_MODE: 'mock', VITE_AUTH_MODE: '', VITE_API_BASE_URL: '' },
        },
      }),
});
