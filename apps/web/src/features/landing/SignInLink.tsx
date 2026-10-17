import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth';

/**
 * The way into the app. On a deployed site (Cognito) it goes straight to the real hosted sign-in
 * instead of stopping at an extra page; with the practice sign-in it is an ordinary link to it.
 */
export function SignInLink({ className, children }: { className?: string; children: ReactNode }) {
  const { mode, signInCognito, pending } = useAuth();
  if (mode === 'cognito') {
    return (
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => signInCognito('/')}
      >
        {children}
      </button>
    );
  }
  return (
    <Link to="/sign-in" className={className}>
      {children}
    </Link>
  );
}
