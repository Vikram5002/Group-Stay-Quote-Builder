import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';
import { createMockStore } from './store';

export function startMockApi() {
  return setupWorker(...createHandlers(createMockStore())).start({
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
