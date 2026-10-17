import type { ReactNode } from 'react';

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
    <div className="rounded-card border border-dashed border-border-strong bg-surface p-8 text-center">
      <Heading className="text-base font-semibold">{title}</Heading>
      {children && <p className="mx-auto mt-1 max-w-prose text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
