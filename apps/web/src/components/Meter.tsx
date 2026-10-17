import { useId } from 'react';
import { cn } from '../lib/cn';
import { formatInr } from '../lib/format';
import { Badge } from './Badge';

/**
 * Contribution meter with a labelled floor marker. The caller passes numbers (the quote
 * builder will compute them with @c32/core); a null contribution is shown as Unknown.
 */
export function ContributionMeter({
  contribution,
  floor,
  max,
  label = 'Contribution',
  floorLabel = 'Floor',
  okText = 'Meets floor',
  belowText = 'Below floor: review required',
}: {
  contribution: number | null;
  floor: number;
  max: number;
  /** What the bar measures, for example "Revenue after discount". */
  label?: string;
  floorLabel?: string;
  okText?: string;
  belowText?: string;
}) {
  const labelId = useId();
  const scale = Math.max(max, floor, contribution ?? 0, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  const below = contribution !== null && contribution < floor;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="text-sm font-semibold">
          {label}
        </span>
        {contribution === null ? (
          <Badge tone="unknown">Unknown</Badge>
        ) : below ? (
          <Badge tone="danger">{belowText}</Badge>
        ) : (
          <Badge tone="success">{okText}</Badge>
        )}
      </div>
      <div
        {...(contribution === null
          ? {
              role: 'img',
              'aria-label': `${label}: Unknown, ${floorLabel.toLowerCase()} ${formatInr(floor)}`,
            }
          : {
              role: 'meter',
              'aria-labelledby': labelId,
              'aria-valuemin': 0,
              'aria-valuemax': scale,
              'aria-valuenow': contribution,
              'aria-valuetext': `${formatInr(contribution)}, ${floorLabel.toLowerCase()} ${formatInr(floor)}`,
            })}
        className="relative h-4 rounded-full bg-surface-muted"
      >
        {contribution !== null && (
          <div
            className={cn(
              'h-full rounded-full transition-[width,background-color] duration-500 ease-out',
              below ? 'bg-danger' : 'bg-success',
            )}
            style={{ width: pct(contribution) }}
          />
        )}
        <div
          aria-hidden="true"
          className="absolute -top-1 h-6 w-0.5 bg-ink"
          style={{ left: pct(floor) }}
        />
      </div>
      <div className="relative mt-1 h-5 text-xs text-ink-muted">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(floor) }}>
          {floorLabel} {formatInr(floor)}
        </span>
      </div>
    </div>
  );
}
