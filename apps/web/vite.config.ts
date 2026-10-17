import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // Tailwind is skipped under test so index.css can be imported raw by the contrast test.
  plugins: [react(), ...(mode === 'test' ? [] : [tailwindcss()])],
  resolve: {
    alias: {
      // Use the contract source directly so the web app never builds against a stale dist.
      '@c32/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    // Screens wait on the mock API and a debounce; a busy machine needs more than the 5 s default.
    testTimeout: 15_000,
    // Tests never read a developer's .env.local (for example the real-API settings in the README).
    env: { VITE_API_MODE: 'mock', VITE_AUTH_MODE: '', VITE_API_BASE_URL: '' },
    include: ['src/**/*.test.{ts,tsx}'],
    css: { include: [/index.css/] },
    setupFiles: ['./src/test/setup.ts'],
  },
}));
