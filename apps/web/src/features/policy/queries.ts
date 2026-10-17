import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../app/ApiProvider';
import { useAuth } from '../auth/auth';

export const POLICY_KEY = ['policy'] as const;

/**
 * The property policy where the API allows it. GET /v1/policy is for Owners only, so for other
 * roles this stays empty and callers fall back to the server's own checks, never to a guess.
 */
export function usePolicy() {
  const api = useApi();
  const { session } = useAuth();
  return useQuery({
    queryKey: POLICY_KEY,
    queryFn: () => api.getPolicy(),
    enabled: session?.user.role === 'Owner',
  });
}
