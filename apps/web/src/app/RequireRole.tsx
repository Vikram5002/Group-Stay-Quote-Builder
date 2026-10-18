import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Role } from '@c32/core';
import { EmptyState } from '../components';
import { useAuth } from '../features/auth/auth';
import { ROLE_LABEL } from '../lib/roles';

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
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        Not allowed
      </h1>
      <div className="mt-6">
        <EmptyState
          title="Your role cannot open this screen"
          action={
            <Link
              to="/"
              className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
            >
              Back to the dashboard
            </Link>
          }
        >
          This screen is for {roles.map((r) => ROLE_LABEL[r]).join(' or ')}. You are signed in as{' '}
          {session ? ROLE_LABEL[session.user.role] : 'nobody'}. Ask a Service Manager, or sign in with a different role.
        </EmptyState>
      </div>
    </div>
  );
}
