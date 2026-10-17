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
    include: ['src/**/*.test.{ts,tsx}'],
    css: { include: [/index.css/] },
    setupFiles: ['./src/test/setup.ts'],
  },
}));
