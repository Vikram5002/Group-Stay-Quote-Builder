import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

interface FieldFrameProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: (ids: {
    inputId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

function FieldFrame({ label, hint, error, required, children }: FieldFrameProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        )}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}

const controlClass =
  'min-h-11 w-full rounded-control border bg-surface px-3 text-base text-ink placeholder:text-ink-muted disabled:bg-surface-muted';

function borderFor(invalid: boolean) {
  return invalid ? 'border-danger' : 'border-border-strong';
}

type BaseProps = { label: string; hint?: string; error?: string };

export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, borderFor(invalid), className)}
          {...rest}
        />
      )}
    </FieldFrame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, borderFor(invalid), className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          id={inputId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, 'py-2', borderFor(invalid), className)}
          {...rest}
        />
      )}
    </FieldFrame>
  );
}

export function CheckboxField({
  label,
  hint,
  className,
  ...rest
}: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        className="mt-1 size-5 accent-brand"
        {...rest}
      />
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-sm text-ink-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
