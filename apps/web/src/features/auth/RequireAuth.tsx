import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

/** Sends signed-out visitors to the sign-in page and brings them back afterwards. */
export function RequireAuth() {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
