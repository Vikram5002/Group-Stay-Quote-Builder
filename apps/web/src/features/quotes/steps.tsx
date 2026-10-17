import { INCLUSION_BASES } from '@c32/core';
import type { Policy } from '@c32/core';
import { Alert, Button, Card, CheckboxField, SelectField, TextField } from '../../components';
import { newInclusion, ROOM_TYPES } from './form';
import type { InclusionBasisValue, InclusionForm, QuoteForm } from './form';

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
          hint="1 to 28 nights."
          {...err(errors, 'stay.nights')}
        />
      </div>
      {tooLate && (
        <div className="mt-4">
          <Alert tone="warning" title="Too late to quote for this date">
            {policy
              ? `A quote must stay open at least ${policy.min_validity_hours} hours before the stay cutoff, ${policy.stay_cutoff_hours} hours before check-in.`
              : 'A quote must stay open for a minimum time before the stay cutoff, and this check-in is too close.'}{' '}
            The request will be declined. Choose a later date.
          </Alert>
        </div>
      )}
    </Card>
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
            <option key={t.value} value={t.value}>
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

export function PricingStep({ form, patch, errors }: StepProps) {
  const update = (id: string, changes: Partial<InclusionForm>) =>
    patch({ inclusions: form.inclusions.map((i) => (i.id === id ? { ...i, ...changes } : i)) });
  return (
    <div className="flex flex-col gap-6">
      <Card title="Pricing">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Rate per room per night (INR)"
            name="rate_per_room_night_inr"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.rate}
            onChange={(e) => patch({ rate: e.target.value })}
            hint="Leave blank to use the rate plan."
            {...err(errors, 'rate_per_room_night_inr')}
          />
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
          <Button
            variant="secondary"
            onClick={() => patch({ inclusions: [...form.inclusions, newInclusion()] })}
          >
            Add inclusion
          </Button>
        }
      >
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
