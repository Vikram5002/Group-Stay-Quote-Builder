import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  /** Right-align numeric columns. */
  numeric?: boolean;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={cn(
                  'px-4 py-3 text-[0.72rem] font-medium tracking-wide whitespace-nowrap text-ink-muted uppercase',
                  c.numeric && 'text-right',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-t border-border/70 transition-colors first:border-t-0 hover:bg-surface-muted/60"
            >
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={cn('px-4 py-3.5', c.numeric && 'text-right tabular-nums')}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
