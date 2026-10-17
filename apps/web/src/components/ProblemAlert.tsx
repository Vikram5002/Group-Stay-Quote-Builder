import type { ReactNode } from 'react';
import { ApiError, problemText } from '../lib/api';
import { Alert } from './Alert';

/**
 * A failed action, in the server's own words (see problemText), with the request id for support.
 * Every action uses it, so the same refusal reads the same everywhere. Renders nothing without
 * an error, so it can sit where the error belongs, for example inside the action's dialog.
 */
export function ProblemAlert({
  error,
  title,
  action,
}: {
  error: unknown;
  /** What failed, for example "Could not extend the validity". */
  title: string;
  action?: ReactNode;
}) {
  if (!error) return null;
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Alert tone="danger" title={title} action={action}>
      {problemText(error)}
      {requestId && <span className="block text-xs">Request id: {requestId}</span>}
    </Alert>
  );
}
