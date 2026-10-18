import { useQuery } from '@tanstack/react-query';
import { addDays, INCLUSION_BASES, stayNights } from '@c32/core';
import type { InventoryNight, Policy, QuoteRequest, QuoteTotals } from '@c32/core';
import { useApi } from '../../app/ApiProvider';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  SegmentedControl,
  SelectField,
  TextField,
} from '../../components';
import { formatDate, formatDateShort, formatInr, formatStay } from '../../lib/format';
import { counted } from '../../lib/plural';
import { newInclusion, ROOM_TYPES, STEPS } from './form';
import type { DiscountKind, InclusionBasisValue, InclusionForm, QuoteForm } from './form';
import { AVAILABILITY_KEY } from './queries';
import { describePricing } from './pricingText';

interface StepProps {
  form: QuoteForm;
  patch: (changes: Partial<QuoteForm>) => void;
  /**
   * Field errors by request path, for fields the person has changed or left, or all of them
   * after they try to continue. Each input's name is its request path.
   */
  errors: Record<string, string>;
}

const err = (errors: Record<string, string>, path: string) =>
  errors[path] ? { error: errors[path] } : {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The check-out date for a check-in and a number of nights, or null while either is unfinished. */
export function checkOutDate(checkIn: string, nights: string): string | null {
  const n = Number(nights);
  if (!ISO_DATE.test(checkIn) || nights.trim() === '' || !Number.isInteger(n) || n < 1 || n > 28) {
    return null;
  }
  return addDays(checkIn, n);
}

export function GroupStep({
  form,
  patch,
  errors,
  today,
  tooLate,
  policy,
}: StepProps & {
  /** Today in the property time zone: the earliest check-in. */
  today: string;
  /** The server says this check-in leaves too little time before the stay cutoff. */
  tooLate: boolean;
  /** For the numbers in the too-late warning, when this role can read the policy. */
  policy?: Policy | undefined;
}) {
  const checkOut = checkOutDate(form.checkIn, form.nights);
  return (
    <Card title="Group and dates">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Organiser name"
          name="organiser.name"
          required
          value={form.organiser}
          onChange={(e) => patch({ organiser: e.target.value })}
          hint="The group or company asking for the quote."
          {...err(errors, 'organiser.name')}
        />
        <TextField
          label="Reference (optional)"
          name="organiser.reference"
          value={form.reference}
          onChange={(e) => patch({ reference: e.target.value })}
          {...err(errors, 'organiser.reference')}
        />
        <TextField
          label="Contact person (optional)"
          name="organiser.contact_name"
          autoComplete="name"
          value={form.contactName}
          onChange={(e) => patch({ contactName: e.target.value })}
          hint="Who the quotation is addressed to."
          {...err(errors, 'organiser.contact_name')}
        />
        <TextField
          label="Email (optional)"
          name="organiser.email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => patch({ email: e.target.value })}
          {...err(errors, 'organiser.email')}
        />
        <TextField
          label="Phone (optional)"
          name="organiser.phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => patch({ phone: e.target.value })}
          {...err(errors, 'organiser.phone')}
        />
        <TextField
          label="Check-in date"
          name="stay.check_in"
          type="date"
          required
          min={today}
          value={form.checkIn}
          onChange={(e) => patch({ checkIn: e.target.value })}
          {...err(errors, 'stay.check_in')}
        />
        <TextField
          label="Nights"
          name="stay.nights"
          type="number"
          inputMode="numeric"
          min={1}
          max={28}
          required
          value={form.nights}
          onChange={(e) => patch({ nights: e.target.value })}
          hint={checkOut ? `1 to 28 nights. Check-out ${formatDate(checkOut)}.` : '1 to 28 nights.'}
          {...err(errors, 'stay.nights')}
        />
      </div>
      {tooLate && (
        <div className="mt-4">
          <Alert tone="warning" title="Too late to quote for this date">
            {policy
              ? `A quote must stay open at least ${counted(policy.min_validity_hours, 'hour')} before the stay cutoff, ${counted(policy.stay_cutoff_hours, 'hour')} before check-in.`
              : 'A quote must stay open for a minimum time before the stay cutoff, and this check-in is too close.'}{' '}
            The request will be declined. Choose a later date.
          </Alert>
        </div>
      )}
    </Card>
  );
}

/** What the calendar says about these nights, in one line, before the engine prices them. */
export function availabilityLine(
  nights: readonly string[],
  rows: readonly InventoryNight[],
  roomType: string,
  rooms: number | null,
): { tone: 'info' | 'warning'; text: string } {
  const byDate = new Map(rows.map((r) => [r.date, r] as const));
  const missing = nights.filter((d) => !byDate.has(d));
  if (missing.length > 0) {
    return {
      tone: 'warning',
      text: `${roomType} rooms are not on sale on ${missing.map(formatDateShort).join(', ')}, so they cannot be held.`,
    };
  }
  const unknown = nights.filter((d) => byDate.get(d)?.available_units === null);
  if (unknown.length > 0) {
    return {
      tone: 'warning',
      text: `Availability is not known on ${unknown.map(formatDateShort).join(', ')}, so no rooms can be held until it is. The quote goes to an Owner.`,
    };
  }
  const free = Math.min(...nights.map((d) => byDate.get(d)?.available_units ?? 0));
  if (free === 0) {
    const full = nights.filter((d) => byDate.get(d)?.available_units === 0);
    return {
      tone: 'warning',
      text: `No ${roomType} rooms are free on ${full.map(formatDateShort).join(', ')}.`,
    };
  }
  const line = `Up to ${counted(free, `${roomType} room`)} free on every night of this stay.`;
  return rooms !== null && rooms > free
    ? { tone: 'warning', text: `${line} Asking for ${rooms} gives a partial offer of ${free}.` }
    : { tone: 'info', text: line };
}

function AvailabilityHint({ form }: { form: QuoteForm }) {
  const api = useApi();
  const checkOut = checkOutDate(form.checkIn, form.nights);
  const nights = checkOut ? stayNights(form.checkIn, Number(form.nights)) : [];
  const last = nights[nights.length - 1];
  const query = useQuery({
    queryKey: [...AVAILABILITY_KEY, form.roomType, form.checkIn, last],
    queryFn: () =>
      api.getAvailability({ room_type: form.roomType, from: form.checkIn, to: last as string }),
    enabled: last !== undefined,
  });
  if (!last || query.isError) return null;
  if (query.isPending) {
    return <p className="text-sm text-ink-muted">Checking free rooms for these nights…</p>;
  }
  const label = ROOM_TYPES.find((t) => t.code === form.roomType)?.label ?? form.roomType;
  const rooms = Number(form.rooms);
  const line = availabilityLine(
    nights,
    query.data.nights,
    label,
    form.rooms.trim() !== '' && Number.isInteger(rooms) ? rooms : null,
  );
  return (
    <p
      className={line.tone === 'warning' ? 'text-sm font-semibold text-warning' : 'text-sm'}
      role="status"
    >
      {line.text} The price check confirms it.
    </p>
  );
}

export function RoomsStep({ form, patch, errors }: StepProps) {
  return (
    <Card title="Rooms and type">
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Room type"
          name="room_type"
          required
          value={form.roomType}
          onChange={(e) => patch({ roomType: e.target.value })}
          {...err(errors, 'room_type')}
        >
          {ROOM_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Rooms"
          name="rooms"
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          required
          value={form.rooms}
          onChange={(e) => patch({ rooms: e.target.value })}
          hint="If fewer are available, you will see a partial offer."
          {...err(errors, 'rooms')}
        />
      </div>
      <div className="mt-4">
        <AvailabilityHint form={form} />
      </div>
    </Card>
  );
}

const BASIS_LABEL: Record<InclusionBasisValue, string> = {
  per_guest_night: 'Per guest per night',
  per_room_night: 'Per room per night',
};

function InclusionRow({
  inclusion,
  index,
  errors,
  onChange,
  onRemove,
}: {
  inclusion: InclusionForm;
  index: number;
  errors: Record<string, string>;
  onChange: (changes: Partial<InclusionForm>) => void;
  onRemove: () => void;
}) {
  const path = (field: string) => `inclusions.${index}.${field}`;
  return (
    <li className="rounded-card border border-border p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={`Inclusion ${index + 1} name`}
          name={path('name')}
          required
          value={inclusion.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Breakfast"
          {...err(errors, path('name'))}
        />
        <SelectField
          label="Charged"
          name={path('basis')}
          value={inclusion.basis}
          onChange={(e) => onChange({ basis: e.target.value as InclusionBasisValue })}
        >
          {INCLUSION_BASES.map((b) => (
            <option key={b} value={b}>
              {BASIS_LABEL[b]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Cost to the hotel per unit (INR)"
          name={path('unit_cost_inr')}
          type="number"
          inputMode="numeric"
          min={0}
          disabled={inclusion.costUnknown}
          value={inclusion.costUnknown ? '' : inclusion.unitCost}
          onChange={(e) => onChange({ unitCost: e.target.value })}
          {...err(errors, path('unit_cost_inr'))}
        />
        <div className="flex flex-col justify-end gap-3">
          <CheckboxField
            label="Cost is not known yet"
            name={path('unit_cost_inr')}
            hint="The quote will need Owner review. It is never treated as zero."
            checked={inclusion.costUnknown}
            onChange={(e) => onChange({ costUnknown: e.target.checked })}
          />
        </div>
        <CheckboxField
          label="Already included in the room rate"
          name={path('price_inr')}
          checked={inclusion.includedInRate}
          onChange={(e) => onChange({ includedInRate: e.target.checked })}
        />
        {!inclusion.includedInRate && (
          <TextField
            label="Extra price charged per unit (INR)"
            name={path('price_inr')}
            type="number"
            inputMode="numeric"
            min={0}
            required
            hint="Charged on top of the rate. Enter 0 if there is no extra charge."
            value={inclusion.price}
            onChange={(e) => onChange({ price: e.target.value })}
            {...err(errors, path('price_inr'))}
          />
        )}
      </div>
      <Button variant="ghost" className="mt-3" onClick={onRemove}>
        Remove inclusion {index + 1}
      </Button>
    </li>
  );
}

/** Common extras, added with the usual basis; the cost is still typed in. */
const PRESETS: ReadonlyArray<{ name: string; basis: InclusionBasisValue }> = [
  { name: 'Breakfast', basis: 'per_guest_night' },
  { name: 'Lunch', basis: 'per_guest_night' },
  { name: 'Dinner', basis: 'per_guest_night' },
  { name: 'Parking', basis: 'per_room_night' },
];

const DISCOUNT_KINDS = [
  { value: 'pct', label: '%' },
  { value: 'inr', label: '₹ per room-night' },
] as const;

export function PricingStep({
  form,
  patch,
  errors,
  request,
  totals,
}: StepProps & {
  /** The request when the form is valid, to show the price it gives. */
  request: QuoteRequest | null;
  /** The last price check, for the full price and the Sales limit. */
  totals: QuoteTotals | undefined;
}) {
  const update = (id: string, changes: Partial<InclusionForm>) =>
    patch({ inclusions: form.inclusions.map((i) => (i.id === id ? { ...i, ...changes } : i)) });
  const add = (preset?: { name: string; basis: InclusionBasisValue }) =>
    patch({ inclusions: [...form.inclusions, { ...newInclusion(), ...preset }] });
  const added = new Set(form.inclusions.map((i) => i.name.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-6">
      <Card title="Pricing">
        {totals && (
          <p className="mb-4 text-sm">
            Full price {formatInr(totals.floor_rate_per_room_night_inr)} per room-night. Sales can
            give up to {totals.max_discount_pct}% off
            {totals.min_rate_per_room_night_inr !== null &&
              ` (down to ${formatInr(totals.min_rate_per_room_night_inr)})`}{' '}
            alone; a lower price goes to an Owner.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <SegmentedControl<DiscountKind>
              legend="Discount in"
              value={form.discountKind}
              options={DISCOUNT_KINDS}
              // A new unit starts from no discount, so 10% never silently becomes ₹10.
              onChange={(discountKind) => patch({ discountKind, discount: '0', rate: '' })}
            />
            <TextField
              label={
                form.discountKind === 'pct'
                  ? 'Discount off full price (%)'
                  : 'Discount off full price (₹ per room-night)'
              }
              name={form.discountKind === 'pct' ? 'discount_pct' : 'discount_inr'}
              type="number"
              inputMode="numeric"
              min={0}
              {...(form.discountKind === 'pct' ? { max: 100 } : {})}
              value={form.discount}
              onChange={(e) => patch({ discount: e.target.value, rate: '' })}
              hint="Up to the owner's limit Sales can confirm alone; more goes to the owner."
              {...err(errors, form.discountKind === 'pct' ? 'discount_pct' : 'discount_inr')}
            />
          </div>
          <TextField
            label="Or a fixed rate per room-night (INR)"
            name="rate_per_room_night_inr"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.rate}
            onChange={(e) => patch({ rate: e.target.value })}
            hint="Optional. Replaces the discount, for example to cover a bundled extra."
            {...err(errors, 'rate_per_room_night_inr')}
          />
          {request && totals && (
            <p className="text-sm font-semibold md:col-span-2">
              Price: {describePricing(request, totals).text}
            </p>
          )}
          <TextField
            label="Guests per room"
            name="guests_per_room_units"
            type="number"
            inputMode="numeric"
            min={1}
            max={6}
            value={form.guests}
            onChange={(e) => patch({ guests: e.target.value })}
            hint="Used for per-guest inclusions. Leave blank to use the policy default."
            {...err(errors, 'guests_per_room_units')}
          />
        </div>
      </Card>
      <Card
        title="Inclusions"
        actions={
          <Button variant="secondary" onClick={() => add()}>
            Add inclusion
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Quick add">
          <span className="text-sm text-ink-muted">Quick add:</span>
          {PRESETS.filter((p) => !added.has(p.name.toLowerCase())).map((p) => (
            <Button
              key={p.name}
              variant="ghost"
              className="border border-border"
              aria-label={`Add ${p.name.toLowerCase()}`}
              onClick={() => add(p)}
            >
              + {p.name}
            </Button>
          ))}
        </div>
        {form.inclusions.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No inclusions. Add breakfast or other costed extras if the group needs them.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {form.inclusions.map((inc, index) => (
              <InclusionRow
                key={inc.id}
                inclusion={inc}
                index={index}
                errors={errors}
                onChange={(changes) => update(inc.id, changes)}
                onRemove={() =>
                  patch({ inclusions: form.inclusions.filter((i) => i.id !== inc.id) })
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The details entered, as the client will read them, each with a way back to its step. */
export function ReviewDetails({
  form,
  request,
  totals,
  onEdit,
}: {
  form: QuoteForm;
  request: QuoteRequest | null;
  totals: QuoteTotals | undefined;
  onEdit: (step: number) => void;
}) {
  const checkOut = checkOutDate(form.checkIn, form.nights);
  const roomType = ROOM_TYPES.find((t) => t.code === form.roomType)?.label ?? form.roomType;
  const contact = [form.contactName, form.email, form.phone].map((v) => v.trim()).filter(Boolean);
  const edit = (step: number) => (
    <Button
      variant="ghost"
      className="min-h-0 px-2 py-1 text-xs"
      aria-label={`Edit ${STEPS[step]?.label.toLowerCase()}`}
      onClick={() => onEdit(step)}
    >
      Edit
    </Button>
  );
  const row = (label: string, value: React.ReactNode, step?: number) => (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2 last:border-0">
      <dt className="w-32 text-ink-muted">{label}</dt>
      <dd className="flex flex-1 items-start justify-between gap-2">
        <span>{value}</span>
        {step !== undefined && edit(step)}
      </dd>
    </div>
  );
  return (
    <Card title="Check the details">
      <dl className="text-sm">
        {row(
          'Group',
          <>
            {form.organiser.trim()}
            {form.reference.trim() && (
              <span className="block text-ink-muted">Ref {form.reference.trim()}</span>
            )}
            {contact.length > 0 && (
              <span className="block text-ink-muted">{contact.join(' · ')}</span>
            )}
          </>,
          0,
        )}
        {row(
          'Stay',
          checkOut
            ? `${formatStay(form.checkIn, checkOut)} (${counted(Number(form.nights), 'night')})`
            : form.checkIn,
          0,
        )}
        {row('Rooms', counted(Number(form.rooms), `${roomType} room`), 1)}
        {row(
          'Price',
          request && totals ? describePricing(request, totals).text : 'Waiting for the price check',
          2,
        )}
        {row(
          'Inclusions',
          form.inclusions.length === 0
            ? 'None'
            : form.inclusions.map((i) => i.name.trim() || 'Unnamed').join(', '),
          2,
        )}
      </dl>
    </Card>
  );
}

const FIELD_LABELS: Record<string, string> = {
  'organiser.name': 'Organiser name',
  'organiser.reference': 'Reference',
  'organiser.contact_name': 'Contact person',
  'organiser.email': 'Email',
  'organiser.phone': 'Phone',
  stay: 'Stay',
  'stay.check_in': 'Check-in date',
  'stay.nights': 'Nights',
  room_type: 'Room type',
  rooms: 'Rooms',
  discount_pct: 'Discount',
  discount_inr: 'Discount',
  rate_per_room_night_inr: 'Fixed rate',
  guests_per_room_units: 'Guests per room',
};
const INCLUSION_FIELDS: Record<string, string> = {
  name: 'name',
  basis: 'basis',
  unit_cost_inr: 'cost',
  price_inr: 'extra price',
};

/** The field a request path belongs to, in the words on screen. */
export function fieldLabel(path: string): string {
  const inclusion = /^inclusions\.(\d+)\.(\w+)/.exec(path);
  if (inclusion) {
    const field = INCLUSION_FIELDS[inclusion[2] as string] ?? 'details';
    return `Inclusion ${Number(inclusion[1]) + 1} ${field}`;
  }
  return FIELD_LABELS[path] ?? path;
}
