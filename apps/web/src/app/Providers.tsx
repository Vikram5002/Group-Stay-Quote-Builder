import type { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/auth';
import type { Session } from '../features/auth/auth';
import { ApiProvider } from './ApiProvider';

export function Providers({
  children,
  initialSession,
  fetchImpl,
}: {
  children: ReactNode;
  initialSession?: Session | null;
  fetchImpl?: typeof fetch;
}) {
  return (
    <AuthProvider {...(initialSession !== undefined ? { initialSession } : {})}>
      <ApiProvider {...(fetchImpl ? { fetchImpl } : {})}>{children}</ApiProvider>
    </AuthProvider>
  );
}
