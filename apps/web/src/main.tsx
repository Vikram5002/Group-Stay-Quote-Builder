import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from './app/Providers';
import { createAppRouter } from './app/router';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

// Mock mode is the default in development until the dev API exists. Set VITE_API_MODE=api to use it.
const mode = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'mock' : 'api');

async function start(root: HTMLElement) {
  if (mode === 'mock') {
    const { startMockApi } = await import('./mocks/browser');
    await startMockApi();
  }
  createRoot(root).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={createAppRouter()} />
      </Providers>
    </StrictMode>,
  );
}

void start(container);
