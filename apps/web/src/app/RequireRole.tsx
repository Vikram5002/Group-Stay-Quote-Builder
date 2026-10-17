import type { ReactNode } from 'react';
import type { Role } from '@c32/core';
import { EmptyState } from '../components';
import { useAuth } from '../features/auth/auth';

/** Blocks a screen for roles the API would refuse anyway, with a plain explanation. */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly Role[] | undefined;
  children: ReactNode;
}) {
  const { session } = useAuth();
  if (!roles || (session && roles.includes(session.user.role))) return <>{children}</>;
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Not allowed</h1>
      <div className="mt-6">
        <EmptyState title="Your role cannot open this screen">
          This screen is for {roles.join(' or ')}. You are signed in as{' '}
          {session?.user.role ?? 'nobody'}. Ask an Owner, or sign in with a different role.
        </EmptyState>
      </div>
    </div>
  );
}
