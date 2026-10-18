import { initialForm, newInclusion } from './form';
import type { QuoteForm } from './form';

/**
 * The wizard's unfinished input, kept for this tab (sessionStorage) so leaving the builder does
 * not lose it. It is cleared when the quote is issued or the person starts over. Storage can be
 * blocked or full; the wizard then works without a draft.
 */
export interface QuoteDraft {
  /** The option being edited (the only one unless options are being compared). */
  form: QuoteForm;
  /** Zero-based step the person was on. */
  step: number;
  /** Every option when two are being compared, and which one was being edited. */
  options?: QuoteForm[];
  active?: number;
}

const DRAFT_KEY = 'c32.quote-draft';

export function isBlank(form: QuoteForm): boolean {
  return JSON.stringify(form) === JSON.stringify(initialForm);
}

/**
 * A form from storage, with any field a newer version added, and fresh inclusion ids so new
 * inclusions cannot clash with them after a reload.
 */
function revive(stored: Partial<QuoteForm>): QuoteForm {
  return {
    ...initialForm,
    ...stored,
    inclusions: (stored.inclusions ?? []).map((inc) => ({ ...inc, id: newInclusion().id })),
  };
}

/** A second option to compare: the same terms, with its own inclusion ids and no note. */
export function copyOption(form: QuoteForm): QuoteForm {
  return {
    ...form,
    inclusions: form.inclusions.map((inc) => ({ ...inc, id: newInclusion().id })),
    noteForOwner: '',
  };
}

export function loadDraft(): QuoteDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<QuoteDraft>;
    if (!draft.form || typeof draft.form !== 'object') return null;
    const options = Array.isArray(draft.options) ? draft.options.slice(0, 2).map(revive) : null;
    const active =
      options && Number.isInteger(draft.active) && (draft.active as number) < options.length
        ? (draft.active as number)
        : 0;
    const form = options ? (options[active] as QuoteForm) : revive(draft.form);
    if ((options ?? [form]).every(isBlank)) return null;
    return {
      form,
      step: Number.isInteger(draft.step) ? (draft.step as number) : 0,
      ...(options && options.length > 1 ? { options, active } : {}),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: QuoteDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Without storage the wizard still works; the draft just does not survive leaving.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
