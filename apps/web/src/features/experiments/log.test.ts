import {
  emptyForm,
  entriesToCsv,
  formatDuration,
  istToUtc,
  nextContactId,
  validateEntry,
} from './log';
import type { ExperimentEntry, ExperimentForm } from './log';

const entry = (overrides: Partial<ExperimentEntry> = {}): ExperimentEntry => ({
  contact_id: 'ORG-01',
  role_played: 'Corporate offsite planner',
  channel: 'Email',
  sent_at: '2026-10-20T04:00:00.000Z',
  responded_at: null,
  quote_kind: 'tool',
  quote_id: null,
  quote_version: null,
  response_summary: '',
  tier_reached: null,
  notes: '',
  ...overrides,
});

const form = (overrides: Partial<ExperimentForm> = {}): ExperimentForm => ({
  ...emptyForm,
  rolePlayed: 'Corporate offsite planner',
  sentAt: '2026-10-20T09:30',
  consent: true,
  ...overrides,
});

describe('experiment log helpers', () => {
  it('treats typed times as IST', () => {
    expect(istToUtc('2026-10-20T09:30')).toBe('2026-10-20T04:00:00.000Z');
    expect(istToUtc('')).toBeNull();
    expect(istToUtc('2026-13-40T09:30')).toBeNull();
  });

  it('numbers contacts in order and never reuses a removed number', () => {
    expect(nextContactId([])).toBe('ORG-01');
    expect(nextContactId([entry(), entry({ contact_id: 'ORG-03' })])).toBe('ORG-04');
  });

  it('formats a wait in plain units', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(135 * 60_000)).toBe('2h 15m');
    expect(formatDuration((3 * 24 + 2) * 3_600_000)).toBe('3d 2h');
  });

  it('accepts a contact with no response and keeps the tier empty', () => {
    const result = validateEntry(form(), [], []);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.entry.responded_at).toBeNull();
    expect(result.entry.tier_reached).toBeNull();
  });

  it('needs consent, a role and a send time', () => {
    const result = validateEntry(form({ rolePlayed: ' ', sentAt: '', consent: false }), [], []);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['consent', 'rolePlayed', 'sentAt']);
  });

  it('keeps a tier tied to a response, in both directions', () => {
    const withoutResponse = validateEntry(form({ tier: '2' }), [], []);
    expect(withoutResponse).toMatchObject({ ok: false });
    const withoutTier = validateEntry(form({ respondedAt: '2026-10-20T11:45' }), [], []);
    expect(withoutTier).toMatchObject({ ok: false });
  });

  it('rejects a response before the send time', () => {
    const result = validateEntry(form({ respondedAt: '2026-10-20T09:00', tier: '1' }), [], []);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.respondedAt).toMatch(/before/);
  });

  it('links a chosen quote and its version', () => {
    const result = validateEntry(form({ quoteId: 'Q1' }), [], [{ quote_id: 'Q1', version: 3 }]);
    if (!result.ok) throw new Error('expected ok');
    expect([result.entry.quote_id, result.entry.quote_version]).toEqual(['Q1', 3]);
  });

  it('exports CSV with no response as an empty cell, not zero', () => {
    const csv = entriesToCsv([
      entry({
        responded_at: '2026-10-20T06:15:00.000Z',
        tier_reached: 2,
        response_summary: 'Asked to include breakfast, and a "late checkout"',
      }),
      entry({ contact_id: 'ORG-02' }),
    ]);
    const [header, first, second] = csv.trim().split('\r\n');
    expect(header).toContain('minutes_to_first_response');
    expect(first).toContain(',135,');
    expect(first).toContain('"Asked to include breakfast, and a ""late checkout"""');
    expect(second).toMatch(/,tool,,,,,,/);
  });
});
