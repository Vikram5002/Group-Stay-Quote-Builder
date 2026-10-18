// Writes sample quote and invoice PDFs to look at the template. Run: npx tsx apps/api/scripts/sample-pdf.ts <dir>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_POLICY, evaluate, validateQuoteRequest, type Quote } from '@c32/core';
import { renderDocument } from '../src/documents/pdf.js';

const dir = process.argv[2] ?? '.';
const v = validateQuoteRequest({
  organiser: { name: 'Fictional Events Pvt Ltd', email: 'events@example.com', reference: 'WED-01' },
  stay: { check_in: '2026-12-10', nights: 3 },
  room_type: 'standard',
  rooms: 5,
  discount_pct: 5,
  additional_lines: [{ stay: { check_in: '2026-12-10', nights: 4 }, rooms: 3 }],
});
if (!v.ok) throw new Error(JSON.stringify(v.problem));
const nights = Array.from({ length: 6 }, (_, i) => `2026-12-${String(10 + i)}`);
const { evaluation } = evaluate(v.value, {
  inventory: nights.map((date) => ({
    date,
    room_type: 'standard',
    total_units: 10,
    available_units: 10,
    held_units: 0,
    confirmed_units: 0,
  })),
  ratePlan: nights.map((date) => ({
    date,
    room_type: 'standard',
    rate_per_room_night_inr: 2000,
    variable_cost_per_room_night_inr: 800,
    rack_rate_inr: null,
  })),
  policy: DEFAULT_POLICY,
  nowMs: Date.parse('2026-10-18T10:00:00+05:30'),
});
const { lines: _lines, ...request } = v.value;
const policy = {
  ...DEFAULT_POLICY,
  hotel_name: 'Hotel Sagar Residency',
  hotel_address: 'Road No. 12, Banjara Hills, Hyderabad 500034',
  hotel_phone: '+91 40 1234 5678',
  hotel_gstin: '36ABCDE1234F1Z5',
};
const quote: Quote = {
  quote_id: '01M561VWQP7Y2Z3X4C5V6B7N8M',
  property_id: 'p1',
  status: 'CONFIRMED',
  version: 3,
  request: { ...request, stay: { check_in: '2026-12-10', nights: 3 } },
  evaluation,
  terms_hash: '0'.repeat(64),
  issued_at: '2026-10-18T04:30:00.000Z',
  valid_until: '2026-10-21T04:30:00.000Z',
  created_by: { user_id: 'sales-1', role: 'Sales' },
  created_at: '2026-10-18T04:30:00.000Z',
  updated_at: '2026-10-18T04:30:00.000Z',
  approval: null,
  review_required: false,
  payment: {
    received_at: '2026-10-19T06:00:00.000Z',
    recorded_by: { user_id: 'owner-1', role: 'Owner' },
    reference: 'UPI 4321',
  },
};
for (const kind of ['quote', 'invoice'] as const) {
  const bytes = await renderDocument({
    kind,
    quote,
    policy,
    nowMs: Date.parse('2026-10-19T06:00:00.000Z'),
  });
  writeFileSync(join(dir, `sample-${kind}.pdf`), bytes);
  console.log(`${kind}: ${bytes.length} bytes`);
}
