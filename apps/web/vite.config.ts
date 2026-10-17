import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // Tailwind is skipped under test so index.css can be imported raw by the contrast test.
  plugins: [react(), ...(mode === 'test' ? [] : [tailwindcss()])],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    css: { include: [/index.css/] },
    setupFiles: ['./src/test/setup.ts'],
  },
}));
