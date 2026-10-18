import { Card, EmptyState } from '../components';
import type { NavItem } from './routes';

export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        {item.label}
      </h1>
      <p className="mt-1 text-ink-muted">{item.description}</p>
      <Card className="mt-6">
        <EmptyState title="Not built yet">
          This screen is planned in work package {item.workPackage}. The shell, routing and shared
          components it will use are already in place.
        </EmptyState>
      </Card>
    </div>
  );
}
