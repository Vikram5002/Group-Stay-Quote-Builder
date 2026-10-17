import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

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
    const from = signedOutBy === 'manual' ? '/' : location.pathname;
    return <Navigate to="/sign-in" replace state={{ from }} />;
  }
  return <Outlet />;
}
