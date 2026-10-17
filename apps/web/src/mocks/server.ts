import { setupServer } from 'msw/node';
import { createHandlers } from './handlers';
import { createMockStore } from './store';
import type { MockStore } from './store';

/** Fresh store and server per test file, so tests never share state. */
export function createTestApi(now?: () => Date): {
  server: ReturnType<typeof setupServer>;
  store: MockStore;
} {
  const store = createMockStore(now);
  return { server: setupServer(...createHandlers(store)), store };
}
