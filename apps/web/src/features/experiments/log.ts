import { toCsv } from '../../lib/csv';

/**
 * Growth experiment log (blueprint 16.6): a fictional event organiser, played by a classmate or
 * mentor with consent, receives a quote and we record what happened. Role-play is process
 * evidence, not market demand.
 */
export const CHANNELS = ['Email', 'WhatsApp', 'Phone', 'In person', 'Other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TIERS = {
  1: 'Replied',
  2: 'Asked for a change',
  3: 'Accepted in the simulation',
  4: 'Asked how to get it for a real event',
} as const;
export type Tier = keyof typeof TIERS;

export type QuoteKind = 'tool' | 'spreadsheet';
export const QUOTE_KIND_LABEL: Record<QuoteKind, string> = {
  tool: 'Quote from this tool',
  spreadsheet: 'Spreadsheet-style quote (for contrast)',
};

export interface ExperimentEntry {
  contact_id: string;
  role_played: string;
  channel: Channel;
  /** UTC instants. They are entered and shown in IST. */
  sent_at: string;
  responded_at: string | null;
  quote_kind: QuoteKind;
  quote_id: string | null;
  quote_version: number | null;
  response_summary: string;
  /** Null until there is a response. */
  tier_reached: Tier | null;
  notes: string;
}

export interface ExperimentForm {
  rolePlayed: string;
  channel: Channel;
  /** datetime-local text, in IST. */
  sentAt: string;
  respondedAt: string;
  quoteKind: QuoteKind;
  quoteId: string;
  responseSummary: string;
  tier: '' | '1' | '2' | '3' | '4';
  notes: string;
  consent: boolean;
}

export const emptyForm: ExperimentForm = {
  rolePlayed: '',
  channel: 'Email',
  sentAt: '',
  respondedAt: '',
  quoteKind: 'tool',
  quoteId: '',
  responseSummary: '',
  tier: '',
  notes: '',
  consent: false,
};

/** "2026-11-01T14:30" typed in IST becomes the UTC instant, or null if it is not a date. */
export function istToUtc(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function nextContactId(entries: readonly ExperimentEntry[]): string {
  const highest = entries.reduce((max, e) => {
    const n = Number(e.contact_id.replace(/^\D+/, ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `ORG-${String(highest + 1).padStart(2, '0')}`;
}

/** "45m", "2h 15m", "3d 2h". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function timeToResponse(entry: ExperimentEntry): string | null {
  if (!entry.responded_at) return null;
  return formatDuration(Date.parse(entry.responded_at) - Date.parse(entry.sent_at));
}

export type FormErrors = Partial<Record<keyof ExperimentForm, string>>;

export interface QuoteRef {
  quote_id: string;
  version: number;
}

export type ValidatedEntry =
  { ok: true; entry: ExperimentEntry } | { ok: false; errors: FormErrors };

export function validateEntry(
  form: ExperimentForm,
  existing: readonly ExperimentEntry[],
  quotes: readonly QuoteRef[],
): ValidatedEntry {
  const errors: FormErrors = {};

  if (!form.rolePlayed.trim())
    errors.rolePlayed = 'Say which role was played, for example "Corporate offsite planner".';
  const sent = istToUtc(form.sentAt);
  if (!sent) errors.sentAt = 'Enter when the quote was sent.';

  const responded = form.respondedAt ? istToUtc(form.respondedAt) : null;
  if (form.respondedAt && !responded)
    errors.respondedAt = 'Enter a valid date and time, or leave it empty.';
  if (sent && responded && Date.parse(responded) < Date.parse(sent)) {
    errors.respondedAt = 'The response cannot be before the quote was sent.';
  }

  if (responded && !form.tier) errors.tier = 'Choose how far the response went.';
  if (!responded && form.tier)
    errors.tier = 'A tier needs a response time. Clear the tier or add the time.';

  if (!form.consent) errors.consent = 'Confirm that the person agreed to play this role.';

  if (Object.keys(errors).length > 0 || !sent) return { ok: false, errors };

  const quote = quotes.find((q) => q.quote_id === form.quoteId);
  return {
    ok: true,
    entry: {
      contact_id: nextContactId(existing),
      role_played: form.rolePlayed.trim(),
      channel: form.channel,
      sent_at: sent,
      responded_at: responded,
      quote_kind: form.quoteKind,
      quote_id: quote?.quote_id ?? null,
      quote_version: quote?.version ?? null,
      response_summary: form.responseSummary.trim(),
      tier_reached: form.tier ? (Number(form.tier) as Tier) : null,
      notes: form.notes.trim(),
    },
  };
}

export const CSV_COLUMNS = [
  'contact_id',
  'role_played',
  'channel',
  'sent_at',
  'responded_at',
  'quote_kind',
  'quote_id',
  'quote_version',
  'minutes_to_first_response',
  'response_summary',
  'tier_reached',
  'notes',
] as const;

/** For evidence/02-final. No response is an empty cell, not zero. */
export function entriesToCsv(entries: readonly ExperimentEntry[]): string {
  return toCsv([
    [...CSV_COLUMNS],
    ...entries.map((e) => [
      e.contact_id,
      e.role_played,
      e.channel,
      e.sent_at,
      e.responded_at,
      e.quote_kind,
      e.quote_id,
      e.quote_version,
      e.responded_at
        ? Math.round((Date.parse(e.responded_at) - Date.parse(e.sent_at)) / 60_000)
        : null,
      e.response_summary,
      e.tier_reached,
      e.notes,
    ]),
  ]);
}
