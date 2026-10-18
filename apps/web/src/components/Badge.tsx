import { cn } from '../lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'unknown';

const tones: Record<Tone, { box: string; icon: string }> = {
  success: { box: 'bg-success-soft text-success border-success/15', icon: '✓' },
  warning: { box: 'bg-warning-soft text-warning border-warning/15', icon: '!' },
  danger: { box: 'bg-danger-soft text-danger border-danger/15', icon: '✕' },
  info: { box: 'bg-info-soft text-info border-info/15', icon: 'i' },
  neutral: { box: 'bg-surface-muted text-ink border-border', icon: '•' },
  unknown: { box: 'bg-unknown-soft text-unknown border-unknown/60 border-dashed', icon: '?' },
};

export function toneIcon(tone: Tone): string {
  return tones[tone].icon;
}

export function toneBox(tone: Tone): string {
  return tones[tone].box;
}

/** Status is always conveyed by text plus an icon; colour is never the only signal. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-xs font-medium whitespace-nowrap',
        toneBox(tone),
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-4 place-items-center rounded-full bg-current/12 text-[0.6rem] leading-none font-bold"
      >
        {tones[tone].icon}
      </span>
      {children}
    </span>
  );
}
