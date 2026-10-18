import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Policy } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import { LeaveGuard } from '../../app/LeaveGuard';
import { Alert, Button, Card, ProblemAlert, Spinner, TextField } from '../../components';
import { ApiError } from '../../lib/api';
import { formatIst } from '../../lib/format';
import {
  describeChanges,
  floorRatePreview,
  formFromPolicy,
  hoursAsDays,
  lowestRatePreview,
  parsePolicy,
  pendingChanges,
  timeIn,
} from './policyForm';
import type { PolicyForm } from './policyForm';
import { POLICY_KEY } from './queries';

/** Common zones offered as suggestions; any IANA name can still be typed. */
const ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Europe/London',
  'UTC',
];

const withDays = (hint: string, value: string) => {
  const days = hoursAsDays(value);
  return days ? `${hint} Now ${days}.` : hint;
};

interface SavedChange {
  version: number;
  at: string;
  changes: string[];
}

export function PolicyPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: POLICY_KEY, queryFn: () => api.getPolicy() });

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedChange[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the form once the policy arrives, and again whenever a newer version is fetched.
  const serverVersion = query.data?.version;
  useEffect(() => {
    if (query.data) setForm(formFromPolicy(query.data));
  }, [query.data, serverVersion]);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updatePolicy>[0]) => api.updatePolicy(body),
    onSuccess: (next) => {
      const before = query.data;
      queryClient.setQueryData(POLICY_KEY, next);
      setNotice(`Policy saved as version ${next.version}.`);
      if (before) {
        setSaved((list) => [
          {
            version: next.version,
            at: new Date().toISOString(),
            changes: describeChanges(before, next),
          },
          ...list,
        ]);
      }
    },
  });

  const heading = (
    <h1 className="text-[1.875rem] leading-tight font-semibold md:text-[2.125rem]">Policy</h1>
  );

  if (query.isPending || (query.data && !form)) {
    return (
      <div className="mx-auto max-w-3xl">
        {heading}
        <p className="mt-6 flex items-center gap-2" role="status">
          <Spinner /> Loading the policy…
        </p>
      </div>
    );
  }
  if (query.isError || !form || !query.data) {
    const error = query.error instanceof ApiError ? query.error : null;
    return (
      <div className="mx-auto max-w-3xl">
        {heading}
        <div className="mt-6">
          <Alert
            tone="danger"
            title={error?.friendly.title ?? 'Could not load the policy'}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {error
              ? `${error.friendly.message} ${error.friendly.nextStep}`
              : 'Try again in a moment.'}
          </Alert>
        </div>
      </div>
    );
  }

  const policy: Policy = query.data;
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromPolicy(policy));
  const conflict = save.error instanceof ApiError && save.error.code === 'VERSION_CONFLICT';
  const failure = save.error instanceof ApiError && !conflict ? save.error : null;

  const set = (changes: Partial<PolicyForm>) => {
    setForm({ ...form, ...changes });
    setNotice(null);
    setErrors({});
  };
  const err = (path: string) => (errors[path] ? { error: errors[path] } : {});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const parsed = parsePolicy(form, policy.version);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(parsed.value);
  }

  async function loadLatest() {
    save.reset();
    setNotice(null);
    await query.refetch();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <LeaveGuard when={dirty && !save.isPending} title="Leave without saving?">
        Your changes to the policy are not saved. If you leave, they are lost.
      </LeaveGuard>
      {heading}
      <p className="mt-1 text-ink-muted">
        Rules the quote engine follows for this property. Version {policy.version}. A save is
        checked against the version you started from, so two people cannot overwrite each other.
      </p>

      {conflict && (
        <div className="mt-4">
          <Alert
            tone="danger"
            title="The policy was changed by someone else"
            action={
              <Button variant="secondary" onClick={() => void loadLatest()}>
                Load the latest version
              </Button>
            }
          >
            Your changes were not saved. Load the latest version, then make your change again.
          </Alert>
        </div>
      )}
      {failure && (
        <div className="mt-4">
          <ProblemAlert error={failure} title="Could not save the policy" />
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-6">
        <Card title="Hotel details">
          <p className="mb-4 text-sm text-ink-muted">
            Printed on every quote and invoice PDF sent to organisers.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Hotel name"
              required
              value={form.hotelName}
              onChange={(e) => set({ hotelName: e.target.value })}
              {...err('hotel_name')}
            />
            <TextField
              label="Phone (optional)"
              value={form.hotelPhone}
              onChange={(e) => set({ hotelPhone: e.target.value })}
              {...err('hotel_phone')}
            />
            <TextField
              label="Address (optional)"
              value={form.hotelAddress}
              onChange={(e) => set({ hotelAddress: e.target.value })}
              {...err('hotel_address')}
            />
            <TextField
              label="GSTIN (optional)"
              value={form.hotelGstin}
              onChange={(e) => set({ hotelGstin: e.target.value })}
              hint="15 characters, for example 36ABCDE1234F1Z5. Shown on invoices."
              {...err('hotel_gstin')}
            />
          </div>
        </Card>

        <Card title="Floor and rooms">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Package floor (INR)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.contributionFloor}
              onChange={(e) => set({ contributionFloor: e.target.value })}
              hint="Divided by total rooms to give the minimum rate per room-night."
              {...err('contribution_floor_inr')}
            />
            <TextField
              label="Total rooms in the hotel"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.totalRooms}
              onChange={(e) => set({ totalRooms: e.target.value })}
              hint="Saving a new number updates every future night's rooms."
              {...err('total_rooms_units')}
            />
            <TextField
              label="Max Sales discount (%)"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={form.maxDiscount}
              onChange={(e) => set({ maxDiscount: e.target.value })}
              hint="Sales can give up to this much off the full price; more needs owner approval."
              {...err('max_sales_discount_pct')}
            />
          </div>
          <p className="mt-4" aria-live="polite">
            {floorRatePreview(form) === null || lowestRatePreview(form) === null ? (
              'Enter the numbers to see the full price and the lowest Sales price.'
            ) : (
              <>
                Full price: <strong>₹{floorRatePreview(form)?.toLocaleString('en-IN')}</strong> per
                room per night, variable cost included. With up to {form.maxDiscount}% off, Sales
                can go down to <strong>₹{lowestRatePreview(form)?.toLocaleString('en-IN')}</strong>;
                anything lower needs owner approval.
              </>
            )}
          </p>
        </Card>

        <Card title="Validity and rooms">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Quote validity (hours)"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.validityHours}
              onChange={(e) => set({ validityHours: e.target.value })}
              hint={withDays(
                'How long rooms stay held after a quote is issued.',
                form.validityHours,
              )}
              {...err('validity_hours')}
            />
            <TextField
              label="Stay cutoff (hours before check-in)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.stayCutoffHours}
              onChange={(e) => set({ stayCutoffHours: e.target.value })}
              hint={withDays('A quote never outlasts this cutoff.', form.stayCutoffHours)}
              {...err('stay_cutoff_hours')}
            />
            <TextField
              label="Minimum validity (hours)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.minValidityHours}
              onChange={(e) => set({ minValidityHours: e.target.value })}
              hint="Shorter windows are declined as too late to quote."
              {...err('min_validity_hours')}
            />
            <TextField
              label="Minimum rooms in a partial offer"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.minPartialRooms}
              onChange={(e) => set({ minPartialRooms: e.target.value })}
              {...err('min_partial_rooms_units')}
            />
            <TextField
              label="Default guests per room"
              type="number"
              inputMode="numeric"
              min={1}
              max={6}
              value={form.guestsPerRoom}
              onChange={(e) => set({ guestsPerRoom: e.target.value })}
              hint="Leave blank if unknown. It is never assumed to be 1."
              {...err('guests_per_room_units')}
            />
            <div>
              <TextField
                label="Time zone"
                value={form.timezone}
                list="policy-zones"
                autoComplete="off"
                onChange={(e) => set({ timezone: e.target.value })}
                hint={
                  timeIn(form.timezone)
                    ? `Dates and "today" use this zone. It is now ${timeIn(form.timezone)} there.`
                    : 'A time zone name such as Asia/Kolkata.'
                }
                {...err('timezone')}
              />
              <datalist id="policy-zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </div>
          </div>
        </Card>

        {dirty && pendingChanges(form, policy).length > 0 && (
          <Card title="Before you save">
            <p className="text-sm">Saving applies to every quote priced from now on:</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {pendingChanges(form, policy).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Save policy
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty}
            onClick={() => {
              setForm(formFromPolicy(policy));
              setErrors({});
            }}
          >
            Discard changes
          </Button>
        </div>
        {notice && <Alert tone="success" title={notice} />}
      </form>

      <section aria-labelledby="changes" className="mt-8">
        <h2 id="changes" className="text-lg font-semibold">
          Changes you saved in this visit
        </h2>
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            None yet. Changes you save are listed here until you leave this page.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {saved.map((entry) => (
              <li
                key={entry.version}
                className="rounded-card border border-border bg-surface p-3 text-sm"
              >
                <p className="font-semibold">
                  Version {entry.version} · <time dateTime={entry.at}>{formatIst(entry.at)}</time>
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {entry.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
