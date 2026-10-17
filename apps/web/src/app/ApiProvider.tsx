import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient, ApiError } from '../lib/api';
import type { ApiClient } from '../lib/api';
import { useAuth } from '../features/auth/auth';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({
  children,
  baseUrl = import.meta.env.VITE_API_BASE_URL ?? '',
  fetchImpl,
}: {
  children: ReactNode;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  const { getToken, signOut } = useAuth();

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl,
        getToken,
        onUnauthenticated: signOut,
        ...(fetchImpl ? { fetchImpl } : {}),
      }),
    [baseUrl, getToken, signOut, fetchImpl],
  );

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retrying a 4xx never helps; the server is authoritative.
            retry: (count, error) =>
              count < 2 && !(error instanceof ApiError && error.status < 500),
            staleTime: 5_000,
          },
          // Mutations are never retried automatically: confirm is not optimistic.
          mutations: { retry: false },
        },
      }),
    [],
  );

  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside ApiProvider');
  return client;
}
