import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  DataTable,
  Dialog,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components';
import { formatIst } from '../../lib/format';
import { useQuoteList } from '../quotes/queries';
import {
  CHANNELS,
  emptyForm,
  entriesToCsv,
  QUOTE_KIND_LABEL,
  TIERS,
  timeToResponse,
  validateEntry,
} from './log';
import type { Channel, ExperimentEntry, ExperimentForm, FormErrors, QuoteKind, Tier } from './log';
import { browserStore } from './store';
import type { ExperimentStore } from './store';
import { counted } from '../../lib/plural';

function downloadCsv(entries: readonly ExperimentEntry[]) {
  const blob = new Blob([entriesToCsv(entries)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'experiment-log.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function Summary({ entries }: { entries: readonly ExperimentEntry[] }) {
  const responded = entries.filter((e) => e.responded_at !== null).length;
  const byTier = ([1, 2, 3, 4] as Tier[]).map(
    (t) => [t, entries.filter((e) => e.tier_reached === t).length] as const,
  );
  return (
    <Card title="Summary">
      <p className="text-sm">
        {counted(entries.length, 'contact')} logged, {responded} responded,{' '}
        {entries.length - responded} with no response yet.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Contacts by tier reached">
        {byTier.map(([tier, count]) => (
          <li key={tier}>
            <Badge
              tone={count > 0 ? 'info' : 'neutral'}
            >{`Tier ${tier}, ${TIERS[tier]}: ${count}`}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ExperimentLogPage({ store = browserStore }: { store?: ExperimentStore }) {
  const [entries, setEntries] = useState<ExperimentEntry[]>(() => store.load());
  const [form, setForm] = useState<ExperimentForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ExperimentEntry | null>(null);
  const quotes = useQuoteList();

  const quoteRefs = (quotes.data?.items ?? []).map((q) => ({
    quote_id: q.quote_id,
    version: q.version,
  }));

  const set = (changes: Partial<ExperimentForm>) => {
    setForm((f) => ({ ...f, ...changes }));
    setSaved(null);
  };
  const err = (field: keyof ExperimentForm) => (errors[field] ? { error: errors[field] } : {});

  function persist(next: ExperimentEntry[]) {
    setEntries(next);
    store.save(next);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = validateEntry(form, entries, quoteRefs);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    persist([...entries, result.entry]);
    setSaved(`${result.entry.contact_id} was added to the log.`);
    setForm({ ...emptyForm, channel: form.channel });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        Experiment log
      </h1>
      <p className="mt-1 text-ink-muted">
        Growth experiment records: who was approached, by which channel, how they responded and how
        far it went.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Alert tone="warning" title="Role-play is process evidence, not market demand">
          Each contact is a fictional organiser played by a classmate or mentor who agreed to take
          part. The report must say so.
        </Alert>
        <Alert tone="info" title="Kept in this browser only">
          The API does not store experiment records yet. Export the CSV and commit it as evidence so
          it is not lost.
        </Alert>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Summary entries={entries} />

        <section aria-labelledby="contacts" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="contacts" className="text-lg font-semibold">
              Contacts
            </h2>
            <Button
              variant="secondary"
              disabled={entries.length === 0}
              onClick={() => downloadCsv(entries)}
            >
              Export CSV
            </Button>
          </div>
          <DataTable
            caption="Experiment contacts"
            rows={entries}
            rowKey={(e) => e.contact_id}
            empty={
              <EmptyState title="No contacts logged yet">
                After you send a quote to a role-playing organiser, add it below. Record no reply as
                it is: leave the response time empty.
              </EmptyState>
            }
            columns={[
              { header: 'Contact', render: (e) => e.contact_id },
              { header: 'Role played', render: (e) => e.role_played },
              { header: 'Channel', render: (e) => e.channel },
              {
                header: 'Quote',
                render: (e) => (
                  <>
                    {QUOTE_KIND_LABEL[e.quote_kind]}
                    {e.quote_id && (
                      <span className="block font-mono text-xs">
                        {e.quote_id.slice(-8)} v{e.quote_version}
                      </span>
                    )}
                  </>
                ),
              },
              {
                header: 'Sent (IST)',
                render: (e) => <time dateTime={e.sent_at}>{formatIst(e.sent_at)}</time>,
              },
              {
                header: 'First response',
                render: (e) =>
                  e.responded_at ? (
                    <>
                      <time dateTime={e.responded_at}>{formatIst(e.responded_at)}</time>
                      <span className="block text-xs text-ink-muted">
                        after {timeToResponse(e)}
                      </span>
                    </>
                  ) : (
                    <Badge tone="unknown">No response yet</Badge>
                  ),
              },
              {
                header: 'Tier',
                render: (e) =>
                  e.tier_reached === null ? (
                    <Badge tone="unknown">None</Badge>
                  ) : (
                    <Badge tone="info">{`${e.tier_reached}: ${TIERS[e.tier_reached]}`}</Badge>
                  ),
              },
              {
                header: 'What they said',
                render: (e) => (
                  <>
                    {e.response_summary || <span className="text-ink-muted">Nothing recorded</span>}
                    {e.notes && (
                      <span className="block text-xs text-ink-muted">Notes: {e.notes}</span>
                    )}
                  </>
                ),
              },
              {
                header: 'Actions',
                render: (e) => (
                  <Button variant="ghost" onClick={() => setRemoving(e)}>
                    {`Remove ${e.contact_id}`}
                  </Button>
                ),
              },
            ]}
          />
        </section>

        <Card title="Log a contact">
          {saved && (
            <div className="mb-4">
              <Alert tone="success" title={saved} />
            </div>
          )}
          <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Role played"
              required
              value={form.rolePlayed}
              onChange={(e) => set({ rolePlayed: e.target.value })}
              hint="For example Corporate offsite planner. Do not enter a person's name."
              {...err('rolePlayed')}
            />
            <SelectField
              label="Channel"
              value={form.channel}
              onChange={(e) => set({ channel: e.target.value as Channel })}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Quote sent"
              value={form.quoteKind}
              onChange={(e) => set({ quoteKind: e.target.value as QuoteKind })}
            >
              {(Object.keys(QUOTE_KIND_LABEL) as QuoteKind[]).map((k) => (
                <option key={k} value={k}>
                  {QUOTE_KIND_LABEL[k]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Quote from this tool (optional)"
              value={form.quoteId}
              onChange={(e) => set({ quoteId: e.target.value })}
              disabled={form.quoteKind === 'spreadsheet'}
              hint="Links the contact to a saved quote and its version."
            >
              <option value="">No quote attached</option>
              {(quotes.data?.items ?? []).map((q) => (
                <option key={q.quote_id} value={q.quote_id}>
                  {`${q.request.organiser.name}, ${q.status.toLowerCase().replace('_', ' ')}, v${q.version}`}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Sent at (IST)"
              type="datetime-local"
              required
              value={form.sentAt}
              onChange={(e) => set({ sentAt: e.target.value })}
              {...err('sentAt')}
            />
            <TextField
              label="First response at (IST)"
              type="datetime-local"
              value={form.respondedAt}
              onChange={(e) => set({ respondedAt: e.target.value })}
              hint="Leave empty if there is no response yet. It is not recorded as zero."
              {...err('respondedAt')}
            />
            <SelectField
              label="How far it went"
              value={form.tier}
              onChange={(e) => set({ tier: e.target.value as ExperimentForm['tier'] })}
              {...err('tier')}
            >
              <option value="">No response</option>
              {([1, 2, 3, 4] as Tier[]).map((t) => (
                <option key={t} value={t}>
                  {`Tier ${t}: ${TIERS[t]}`}
                </option>
              ))}
            </SelectField>
            <div />
            <TextAreaField
              label="What they said"
              value={form.responseSummary}
              onChange={(e) => set({ responseSummary: e.target.value })}
              hint="A short summary, for example Asked to include breakfast."
            />
            <TextAreaField
              label="Notes"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              hint="For example Revised to 2100 per room-night."
            />
            <div className="md:col-span-2">
              <CheckboxField
                label="This person agreed to play the role"
                hint="Only log people who gave consent."
                checked={form.consent}
                onChange={(e) => set({ consent: e.target.checked })}
              />
              {errors.consent && (
                <p className="mt-1 text-sm font-medium text-danger">
                  <span aria-hidden="true">⚠ </span>
                  {errors.consent}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Add to the log</Button>
            </div>
          </form>
        </Card>
      </div>

      <Dialog
        open={removing !== null}
        title="Remove this contact?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) persist(entries.filter((e) => e.contact_id !== removing.contact_id));
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {removing?.contact_id} will be removed from the log in this browser. Export the CSV first
          if you need a record of it.
        </p>
      </Dialog>
    </div>
  );
}
