import type { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/auth';
import type { Session } from '../features/auth/auth';
import { ApiProvider } from './ApiProvider';

export function Providers({
  children,
  initialSession,
  fetchImpl,
  baseUrl,
}: {
  children: ReactNode;
  initialSession?: Session | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}) {
  return (
    <AuthProvider {...(initialSession !== undefined ? { initialSession } : {})}>
      <ApiProvider
        {...(fetchImpl ? { fetchImpl } : {})}
        {...(baseUrl !== undefined ? { baseUrl } : {})}
      >
        {children}
      </ApiProvider>
    </AuthProvider>
  );
}
