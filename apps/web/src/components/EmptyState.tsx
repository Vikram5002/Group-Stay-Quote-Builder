import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function EmptyState({
  title,
  children,
  action,
  as: Heading = 'h2',
}: {
  title: string;
  as?: 'h2' | 'h3';
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-border-strong/50 bg-surface p-10 text-center">
      <span
        aria-hidden="true"
        className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"
      >
        <Icon name="inbox" className="size-6" />
      </span>
      <Heading className="text-base font-semibold">{title}</Heading>
      {children && <p className="mx-auto mt-1 max-w-prose text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
