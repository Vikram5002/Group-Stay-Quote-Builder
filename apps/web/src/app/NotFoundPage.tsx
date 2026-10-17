import { Link } from 'react-router-dom';
import { EmptyState } from '../components';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <div className="mt-6">
        <EmptyState
          title="That address does not match a screen"
          action={
            <Link to="/" className="font-semibold text-brand underline">
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
