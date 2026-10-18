import { cn } from '../lib/cn';

/**
 * A small line-icon set drawn on a 24-unit grid with a 1.75 stroke, so every icon has the same
 * weight. Icons are decoration: they are hidden from assistive technology and always sit next to
 * text that says the same thing.
 */
const PATHS = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v3h6V4zM4 17v3h6v-3z',
  quotes: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  plus: 'M12 5v14M5 12h14',
  review: 'M9 12l2 2 4-4M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
  calendar:
    'M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  transfer: 'M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8',
  policy: 'M4 6h16M4 12h10M4 18h7M17 14v6M14 17h6',
  evidence: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9',
  experiments: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  palette:
    'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  wallet:
    'M4 7a2 2 0 0 1 2-2h11v4M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2zM16 14h.01',
  trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  alert:
    'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5L20 7',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z',
  bed: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5h.01',
  info: 'M12 16v-5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-5 shrink-0', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
