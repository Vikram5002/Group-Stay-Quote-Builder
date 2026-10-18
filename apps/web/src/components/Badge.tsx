import { cn } from '../lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'unknown';

const tones: Record<Tone, { box: string; icon: string }> = {
  success: { box: 'bg-success-soft text-success border-success/30', icon: '✓' },
  warning: { box: 'bg-warning-soft text-warning border-warning/30', icon: '!' },
  danger: { box: 'bg-danger-soft text-danger border-danger/30', icon: '✕' },
  info: { box: 'bg-info-soft text-info border-info/30', icon: 'i' },
  neutral: { box: 'bg-surface-muted text-ink border-border-strong/40', icon: '•' },
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        toneBox(tone),
      )}
    >
      <span aria-hidden="true" className="text-[0.7rem] leading-none">
        {tones[tone].icon}
      </span>
      {children}
    </span>
  );
}
