import { useId } from 'react';
import { cn } from '../lib/cn';

/**
 * A short choice shown as joined buttons, built on native radio inputs so arrow keys, focus and
 * screen readers work as for any radio group.
 */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  hideLegend = false,
}: {
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** Keep the legend for screen readers only, when a nearby label already says it. */
  hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={cn('text-sm font-semibold text-ink', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <div className="inline-flex w-fit rounded-control border border-border-strong bg-surface p-0.5">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'relative inline-flex min-h-10 cursor-pointer items-center rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus',
                checked ? 'bg-brand text-on-brand' : 'text-ink hover:bg-surface-muted',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
