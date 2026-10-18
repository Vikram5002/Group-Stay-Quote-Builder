import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { toneBox, toneIcon } from './Badge';
import type { Tone } from './Badge';

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Exclude<Tone, 'unknown'>;
  title: string;
  children?: ReactNode;
  /** Plain-language next step, for example a "Re-quote" button. */
  action?: ReactNode;
}) {
  // Errors interrupt; everything else is polite.
  const role = tone === 'danger' ? 'alert' : 'status';
  return (
    <div role={role} className={cn('flex gap-3 rounded-card border p-4', toneBox(tone))}>
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-current/10 text-xs font-bold"
      >
        {toneIcon(tone)}
      </span>
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-sm text-ink">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
