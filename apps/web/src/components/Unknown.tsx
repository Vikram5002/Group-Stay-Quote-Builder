import { formatCount, formatInr, UNKNOWN_LABEL } from '../lib/format';

/** A null value. Rendered as the word Unknown with an icon and an explanation, never 0 or blank. */
export function Unknown() {
  return (
    <span
      title="This value is not known. It has not been treated as zero."
      className="inline-flex items-center gap-1 rounded border border-dashed border-unknown bg-unknown-soft px-1.5 text-unknown"
    >
      <span aria-hidden="true">?</span>
      {UNKNOWN_LABEL}
    </span>
  );
}

export function Money({ value }: { value: number | null | undefined }) {
  return value === null || value === undefined ? <Unknown /> : <span>{formatInr(value)}</span>;
}

export function Count({ value }: { value: number | null | undefined }) {
  return value === null || value === undefined ? <Unknown /> : <span>{formatCount(value)}</span>;
}
