import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { toneBox, toneIcon } from './Badge';

type ToastTone = 'success' | 'info' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const SHOW_MS = 6000;

/**
 * Short confirmations after an action ("Quote confirmed", "Summary copied"). They appear in a
 * polite live region, so screen readers announce them without moving focus, and they leave by
 * themselves or with their close button. Errors are not toasts: they stay where they happened.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    next.current += 1;
    const id = next.current;
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
  }, []);

  const value = useMemo(() => notify, [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto"
      >
        {items.map((t) => (
          <ToastMessage key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);
  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-sm items-start gap-3 rounded-card border p-3 text-sm shadow-card',
        toneBox(item.tone),
      )}
    >
      <span aria-hidden="true" className="font-bold">
        {toneIcon(item.tone)}
      </span>
      <p className="flex-1 font-semibold text-ink">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="rounded px-1 text-ink-muted hover:text-ink"
        aria-label="Dismiss"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

/** Show a short confirmation. Outside a provider (some tests) it does nothing. */
export function useToast(): (message: string, tone?: ToastTone) => void {
  return useContext(ToastContext) ?? noop;
}

const noop = () => undefined;
