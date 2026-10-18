import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Card({
  title,
  actions,
  children,
  className,
  ...rest
}: { title?: string; actions?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-card border border-border bg-surface p-6 shadow-card', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
