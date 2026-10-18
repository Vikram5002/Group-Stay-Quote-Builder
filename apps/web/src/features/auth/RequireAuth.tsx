import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

/** What the sign-in page is told: where to return, and whether a session just ended. */
export interface SignInState {
  from: string;
  expired?: boolean;
}

/** Sends signed-out visitors to the sign-in page and brings them back afterwards. */
export function RequireAuth() {
  const { session, signedOutBy, pending } = useAuth();
  const location = useLocation();
  if (pending) {
    return (
      <p role="status" className="p-4">
        Signing you in…
      </p>
    );
  }
  if (!session) {
    // After a deliberate sign-out the next person starts at the beginning, not on this page.
    // Otherwise the same address comes back, filters included (not a hosted sign-in's ?code=).
    const search = /[?&](code|error)=/.test(location.search) ? '' : location.search;
    const from = signedOutBy === 'manual' ? '/' : `${location.pathname}${search}`;
    const state: SignInState = { from, expired: signedOutBy === 'expired' };
    return <Navigate to="/sign-in" replace state={state} />;
  }
  return <Outlet />;
}
