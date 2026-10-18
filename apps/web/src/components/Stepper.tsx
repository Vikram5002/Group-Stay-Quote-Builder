import { cn } from '../lib/cn';

/** Progress through a wizard. Current and finished steps are named in text, not only by colour. */
export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: ReadonlyArray<{ id: string; label: string }>;
  current: number;
  /** When given, finished steps are buttons that open that step again. */
  onSelect?: (index: number) => void;
}) {
  return (
    <nav aria-label="Progress">
      <ol className="flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li
              key={step.id}
              {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold',
                state === 'current' && 'border-brand bg-brand-soft text-brand',
                state === 'done' && 'border-success bg-success-soft text-success',
                state === 'todo' && 'border-border-strong bg-surface text-ink-muted',
              )}
            >
              {state === 'done' && onSelect ? (
                <button
                  type="button"
                  className="flex items-center gap-2 underline-offset-2 hover:underline"
                  onClick={() => onSelect(index)}
                >
                  <span aria-hidden="true">✓</span>
                  <span>{step.label}</span>
                  <span className="sr-only"> (done, open again)</span>
                </button>
              ) : (
                <>
                  <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
                  <span>{step.label}</span>
                  <span className="sr-only">
                    {state === 'done'
                      ? ' (done)'
                      : state === 'current'
                        ? ' (current step)'
                        : ' (not started)'}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
