import { useLocation } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { useAuth } from '../features/auth/auth';

/**
 * The front door. A signed-out visitor at the site root sees the landing page; every other
 * address, and a return from the hosted sign-in (?code= or ?error=), goes through the normal
 * sign-in check so those flows are untouched.
 */
export function RequireAuthOrLanding() {
  const { session } = useAuth();
  const { pathname, search } = useLocation();
  const returningFromSignIn = /[?&](code|error)=/.test(search);
  if (!session && pathname === '/' && !returningFromSignIn) return <LandingPage />;
  return <RequireAuth />;
}
