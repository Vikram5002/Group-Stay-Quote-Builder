import { initialForm, newInclusion } from './form';
import type { QuoteForm } from './form';

/**
 * The wizard's unfinished input, kept for this tab (sessionStorage) so leaving the builder does
 * not lose it. It is cleared when the quote is issued or the person starts over. Storage can be
 * blocked or full; the wizard then works without a draft.
 */
export interface QuoteDraft {
  form: QuoteForm;
  /** Zero-based step the person was on. */
  step: number;
}

const DRAFT_KEY = 'c32.quote-draft';

export function isBlank(form: QuoteForm): boolean {
  return JSON.stringify(form) === JSON.stringify(initialForm);
}

export function loadDraft(): QuoteDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<QuoteDraft>;
    if (!draft.form || typeof draft.form !== 'object') return null;
    // Fill fields a newer version added, and give inclusions fresh ids so new ones cannot clash.
    const form: QuoteForm = {
      ...initialForm,
      ...draft.form,
      inclusions: (draft.form.inclusions ?? []).map((inc) => ({ ...inc, id: newInclusion().id })),
    };
    if (isBlank(form)) return null;
    return { form, step: Number.isInteger(draft.step) ? (draft.step as number) : 0 };
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
