import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  ContributionMeter,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  SelectField,
  TextAreaField,
  TextField,
  Unknown,
} from '../../components';
import type { Tone } from '../../components';
import { TOKEN_GROUPS } from './tokens';

interface Row {
  id: string;
  scenario: string;
  revenue: number | null;
  contribution: number | null;
}

const rows: Row[] = [
  { id: '1', scenario: '10 rooms, 2 nights, rate 2000', revenue: 40000, contribution: 24000 },
  { id: '2', scenario: 'Cost not provided', revenue: 40000, contribution: null },
];

const tones: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral', 'unknown'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`ds-${title}`} className="mt-10">
      <h2 id={`ds-${title}`} className="mb-4 text-xl font-bold">
        {title}
      </h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">
        Design system
      </h1>
      <p className="mt-1 text-ink-muted">
        Tokens and components used across the application. Every text and background pair below is
        contrast-checked by an automated test.
      </p>

      <Section title="Colour tokens">
        {TOKEN_GROUPS.map((group) => (
          <Card key={group.name} title={group.name}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {group.tokens.map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded border border-border"
                    style={{ background: `var(--color-${t})` }}
                  />
                  <code className="font-mono text-xs">{t}</code>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </Section>

      <Section title="Buttons">
        <Card>
          <div className="flex flex-wrap gap-3">
            <Button>Issue quote</Button>
            <Button variant="secondary">Save draft</Button>
            <Button variant="danger">Cancel quote</Button>
            <Button variant="ghost">Learn more</Button>
            <Button disabled>Disabled</Button>
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1500);
              }}
            >
              {loading ? 'Confirming' : 'Confirm (waits for server)'}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Form fields">
        <Card>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
            <TextField
              label="Group name"
              required
              hint="Shown on the quote."
              placeholder="Example Corp offsite"
            />
            <TextField
              label="Rooms"
              type="number"
              min={1}
              error="Enter at least 1 room."
              defaultValue={0}
            />
            <SelectField label="Room type" defaultValue="standard">
              <option value="standard">Standard</option>
              <option value="deluxe">Deluxe</option>
            </SelectField>
            <TextAreaField label="Notes" hint="Optional." />
            <CheckboxField
              label="Breakfast included"
              hint="Adds the breakfast cost to variable cost."
            />
          </form>
        </Card>
      </Section>

      <Section title="Status and feedback">
        <Card title="Badges">
          <div className="flex flex-wrap gap-3">
            {tones.map((t) => (
              <Badge key={t} tone={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Badge>
            ))}
          </div>
        </Card>
        <Alert
          tone="danger"
          title="This quote has expired"
          action={<Button variant="secondary">Re-quote</Button>}
        >
          Rooms were released. Create a new quote to hold them again.
        </Alert>
        <Alert tone="warning" title="Review required">
          Contribution is below the floor, so this quote cannot be auto-confirmed.
        </Alert>
        <Alert tone="success" title="Quote confirmed" />
        <Alert tone="info" title="All data here is synthetic" />
      </Section>

      <Section title="Contribution meter and unknown values">
        <Card>
          <div className="grid gap-8 md:grid-cols-3">
            <ContributionMeter contribution={24000} floor={20000} max={40000} />
            <ContributionMeter contribution={16000} floor={20000} max={40000} />
            <ContributionMeter contribution={null} floor={20000} max={40000} />
          </div>
        </Card>
        <DataTable
          caption="Example quote results; unknown values are labelled"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Scenario', render: (r) => r.scenario },
            { header: 'Revenue', numeric: true, render: (r) => <Money value={r.revenue} /> },
            {
              header: 'Contribution',
              numeric: true,
              render: (r) => <Money value={r.contribution} />,
            },
            { header: 'Floor note', render: () => <Unknown /> },
          ]}
        />
      </Section>

      <Section title="Dialog and empty state">
        <Card>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open approval dialog
          </Button>
          <Dialog
            open={dialogOpen}
            title="Approve below-floor quote"
            onClose={() => setDialogOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setDialogOpen(false)}>Approve</Button>
              </>
            }
          >
            <TextAreaField label="Reason" required hint="Required. Recorded in the audit trail." />
          </Dialog>
        </Card>
        <EmptyState as="h3" title="No quotes yet" action={<Button>Create the first quote</Button>}>
          Quotes you issue will appear here with their status and expiry.
        </EmptyState>
      </Section>
    </div>
  );
}
