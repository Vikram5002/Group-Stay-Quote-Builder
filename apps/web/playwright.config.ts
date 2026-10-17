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
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The full Chromium, so the smaller headless shell is not needed.
    channel: 'chromium',
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
          command: `npm run dev -- --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          // Pinned so a developer's .env.local (real-API settings) never changes what the tests run against.
          env: { VITE_API_MODE: 'mock', VITE_AUTH_MODE: '', VITE_API_BASE_URL: '' },
        },
      }),
});
