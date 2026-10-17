import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FLOOR_MODES } from '@c32/core';
import type { Policy } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import {
  Alert,
  Button,
  Card,
  ProblemAlert,
  SelectField,
  Spinner,
  TextField,
} from '../../components';
import { ApiError } from '../../lib/api';
import { formatIst } from '../../lib/format';
import { describeChanges, formFromPolicy, parsePolicy } from './policyForm';
import type { FloorModeValue, PolicyForm } from './policyForm';
import { POLICY_KEY } from './queries';

const MODE_LABEL: Record<FloorModeValue, string> = {
  absolute: 'One floor for the whole package',
  per_room_night: 'A floor per room-night, scaled by volume',
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

  const heading = <h1 className="text-2xl font-bold">Policy</h1>;

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
      {heading}
      <p className="mt-1 text-ink-muted">
        Rules the quote engine follows for this property. Version {policy.version}. A save is
        checked against the version you started from, so two people cannot overwrite each other.
      </p>

      {notice && (
        <div className="mt-4">
          <Alert tone="success" title={notice} />
        </div>
      )}
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
        <Card title="Contribution floor">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Floor mode"
              value={form.floorMode}
              onChange={(e) => set({ floorMode: e.target.value as FloorModeValue })}
              hint={MODE_LABEL[form.floorMode]}
            >
              {FLOOR_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === 'absolute' ? 'Package floor' : 'Per room-night floor'}
                </option>
              ))}
            </SelectField>
            <div />
            <TextField
              label="Package floor (INR)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.contributionFloor}
              onChange={(e) => set({ contributionFloor: e.target.value })}
              hint="Minimum contribution for the whole package."
              {...err('contribution_floor_inr')}
            />
            <TextField
              label="Floor per room-night (INR)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.floorPerRoomNight}
              onChange={(e) => set({ floorPerRoomNight: e.target.value })}
              hint="Used when the mode is per room-night. Leave blank if unknown."
              {...err('floor_per_room_night_inr')}
            />
          </div>
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
              hint="How long rooms stay held after a quote is issued."
              {...err('validity_hours')}
            />
            <TextField
              label="Stay cutoff (hours before check-in)"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.stayCutoffHours}
              onChange={(e) => set({ stayCutoffHours: e.target.value })}
              hint="A quote never outlasts this cutoff."
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
            <TextField
              label="Time zone"
              value={form.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
              hint="IANA name, for example Asia/Kolkata."
              {...err('timezone')}
            />
          </div>
        </Card>

        <div className="flex flex-wrap gap-3">
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
      </form>

      <section aria-labelledby="changes" className="mt-8">
        <h2 id="changes" className="text-lg font-semibold">
          Changes you saved in this visit
        </h2>
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            None yet. The API does not keep a policy history yet, so this list lasts only until you
            leave the page.
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
