import { Link } from 'react-router-dom';
import { EmptyState } from '../components';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        Page not found
      </h1>
      <div className="mt-6">
        <EmptyState
          title="That address does not match a screen"
          action={
            <Link
              to="/"
              className="font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
            >
              Go to the dashboard
            </Link>
          }
        >
          Check the link, or use the menu to pick a screen.
        </EmptyState>
      </div>
    </div>
  );
}
