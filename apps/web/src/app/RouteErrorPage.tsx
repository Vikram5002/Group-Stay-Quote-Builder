import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { Button, EmptyState } from '../components';

/**
 * Shown in place of a screen that failed while rendering or loading, so a bug never leaves a
 * blank page. Inside the app shell the menu stays usable; the details are there for support.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <div className="mt-6">
        <EmptyState
          title="This screen could not be shown"
          action={
            <span className="flex flex-wrap items-center justify-center gap-4">
              <Button onClick={() => window.location.reload()}>Reload the page</Button>
              <Link to="/" className="font-semibold text-brand underline">
                Go to the dashboard
              </Link>
            </span>
          }
        >
          Nothing you saved is lost: quotes and holds live on the server. Reload to try again.
        </EmptyState>
        <details className="mt-4 text-sm text-ink-muted">
          <summary className="cursor-pointer">Details for support</summary>
          <code className="mt-2 block break-all font-mono text-xs">{detail}</code>
        </details>
      </div>
    </div>
  );
}
