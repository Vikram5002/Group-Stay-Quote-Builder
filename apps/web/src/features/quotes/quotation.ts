import { PROPERTY_ROOM_TYPES } from '@c32/core';
import type { Quote } from '@c32/core';
import { formatCount, formatDate, formatInr, formatIst } from '../../lib/format';
import { A4, PdfDocument, wrapText } from '../../lib/pdf';
import type { Rgb } from '../../lib/pdf';
import { counted } from '../../lib/plural';
import { clientTotal, describePricing } from './pricingText';

/**
 * The quotation the organiser receives: the terms, the price and how long it is valid. It never
 * shows the hotel's costs, contribution or floor. One description feeds both the PDF and the
 * plain-text summary, so the two always agree.
 */

export const APP_NAME = 'Group Stay Quote Builder';

interface Row {
  label: string;
  value: string;
  strong?: boolean;
}

export interface Quotation {
  title: string;
  reference: string;
  issued: string;
  /** Validity in one line, by status: valid until, confirmed, or no longer valid. */
  validity: { tone: 'ok' | 'pending' | 'closed'; text: string };
  preparedFor: Row[];
  stay: Row[];
  price: Row[];
  total: Row;
  terms: string[];
}

const BASIS: Record<string, string> = {
  per_guest_night: 'per guest per night',
  per_room_night: 'per room per night',
};

const roomTypeLabel = (code: string) =>
  PROPERTY_ROOM_TYPES.find((t) => t.code === code)?.label ?? code;

/** The short reference printed on the quotation: the end of the quote id. */
export const shortReference = (quote: Quote) => quote.quote_id.slice(-8);

function validity(quote: Quote): Quotation['validity'] {
  const until = quote.valid_until ? formatIst(quote.valid_until) : null;
  switch (quote.status) {
    case 'OFFERED':
      return { tone: 'ok', text: `Valid until ${until ?? 'further notice'}` };
    case 'PENDING_REVIEW':
      return {
        tone: 'pending',
        text: `Awaiting internal approval. Rooms are held until ${until ?? 'further notice'}.`,
      };
    case 'CONFIRMED':
      return { tone: 'ok', text: `Confirmed booking, ${formatIst(quote.updated_at)}` };
    case 'EXPIRED':
      return { tone: 'closed', text: `Expired ${until ?? ''}: no longer valid`.trim() };
    case 'CANCELLED':
      return { tone: 'closed', text: `Cancelled ${formatIst(quote.updated_at)}: no longer valid` };
    case 'DECLINED':
      return { tone: 'closed', text: 'These rooms and dates could not be offered' };
    case 'REJECTED':
      return { tone: 'closed', text: 'Not approved: no longer valid' };
  }
}

export function quotation(quote: Quote): Quotation {
  const { request, evaluation } = quote;
  const { totals } = evaluation;
  const pricing = describePricing(request, totals);
  const organiser = request.organiser;

  const preparedFor: Row[] = [
    { label: 'Organiser', value: organiser.name },
    ...(organiser.reference ? [{ label: 'Your reference', value: organiser.reference }] : []),
    ...(organiser.contact_name ? [{ label: 'Contact', value: organiser.contact_name }] : []),
    ...(organiser.email ? [{ label: 'Email', value: organiser.email }] : []),
    ...(organiser.phone ? [{ label: 'Phone', value: organiser.phone }] : []),
  ];

  const rooms =
    evaluation.offered_rooms < evaluation.requested_rooms
      ? `${counted(evaluation.offered_rooms, 'room')} (of ${evaluation.requested_rooms} requested)`
      : counted(evaluation.offered_rooms, 'room');
  const stay: Row[] = [
    { label: 'Check-in', value: formatDate(evaluation.check_in) },
    { label: 'Check-out', value: formatDate(evaluation.check_out) },
    { label: 'Nights', value: String(evaluation.nights) },
    { label: 'Room type', value: roomTypeLabel(request.room_type) },
    { label: 'Rooms', value: rooms },
  ];

  const price: Row[] = [];
  if (pricing.discount) {
    price.push({
      label: 'Full price per room-night',
      value: formatInr(totals.floor_rate_per_room_night_inr),
    });
    price.push({ label: 'Discount', value: pricing.discount });
  }
  price.push({
    label: 'Rate per room-night',
    value: pricing.rate === null ? pricing.text : formatInr(pricing.rate),
  });
  price.push({ label: 'Room-nights', value: formatCount(totals.room_nights) });
  price.push({ label: 'Room charges', value: formatInr(totals.room_revenue_inr) });
  for (const inc of request.inclusions ?? []) {
    const charged = !inc.included_in_rate && inc.price_inr !== undefined;
    price.push({
      label: inc.name,
      value: charged
        ? `${formatInr(inc.price_inr as number)} ${BASIS[inc.basis] ?? ''}, charged separately`
        : 'Included in the rate',
    });
  }
  if ((totals.inclusions_revenue_inr ?? 0) > 0 || totals.inclusions_revenue_inr === null) {
    price.push({
      label: 'Extras charged separately',
      value: formatInr(totals.inclusions_revenue_inr),
    });
  }
  const total = clientTotal(totals);

  const terms = [
    ...(quote.status === 'OFFERED' || quote.status === 'PENDING_REVIEW'
      ? ['Rooms are held for you until the date above. After that they are released automatically.']
      : []),
    'This quotation covers the rooms, dates and rate shown. Any change is quoted again.',
    'Amounts are in Indian rupees.',
  ];

  return {
    title: `Quotation for ${organiser.name}`,
    reference: shortReference(quote),
    issued: formatIst(quote.issued_at),
    validity: validity(quote),
    preparedFor,
    stay,
    price,
    total: {
      label: 'Total',
      value: total === null ? 'To be confirmed' : formatInr(total),
      strong: true,
    },
    terms,
  };
}

/** A plain-text version to paste into an email or a message. */
export function quotationText(quote: Quote): string {
  const q = quotation(quote);
  const rows = (list: Row[]) => list.map((r) => `${r.label}: ${r.value}`);
  return [
    `${q.title} (ref ${q.reference})`,
    q.validity.text,
    '',
    ...rows(q.stay),
    '',
    ...rows(q.price),
    `${q.total.label}: ${q.total.value}`,
    '',
    ...q.terms,
  ].join('\n');
}

export function quotationFileName(quote: Quote): string {
  const name = quote.request.organiser.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `quotation-${name || 'group'}-${quote.evaluation.check_in}.pdf`;
}

const INK: Rgb = [17, 24, 39];
const MUTED: Rgb = [75, 85, 99];
const BRAND: Rgb = [43, 79, 216];
const RULE: Rgb = [209, 213, 219];
const TONE: Record<Quotation['validity']['tone'], { fill: Rgb; text: Rgb }> = {
  ok: { fill: [226, 244, 234], text: [22, 101, 52] },
  pending: { fill: [254, 243, 199], text: [146, 64, 14] },
  closed: { fill: [254, 226, 226], text: [153, 27, 27] },
};

/** The quotation as a one-page (or longer) A4 PDF. */
export function quotationPdf(quote: Quote, generatedAt: Date = new Date()): Uint8Array {
  const q = quotation(quote);
  const doc = new PdfDocument({ title: q.title, author: APP_NAME });
  const left = 48;
  const right = A4.width - 48;
  const width = right - left;
  let y = 0;

  const newPage = () => {
    doc.addPage();
    doc.rect(0, 0, A4.width, 70, BRAND);
    doc.text(left, 24, APP_NAME, { font: 'bold', size: 15, color: [255, 255, 255] });
    doc.text(right, 27, 'Group quotation', { size: 11, color: [255, 255, 255], align: 'right' });
    y = 92;
  };
  const ensure = (needed: number) => {
    if (y + needed > A4.height - 60) newPage();
  };
  const heading = (text: string) => {
    ensure(40);
    y += 10;
    doc.text(left, y, text, { font: 'bold', size: 12, color: BRAND });
    y += 18;
    doc.line(left, y, right, y, RULE);
    y += 8;
  };
  const row = (r: Row) => {
    const lines = wrapText(
      r.value,
      r.strong ? 'bold' : 'regular',
      r.strong ? 12 : 10,
      width * 0.58,
    );
    ensure(lines.length * 14 + 6);
    doc.text(left, y, r.label, {
      size: r.strong ? 12 : 10,
      color: r.strong ? INK : MUTED,
      font: r.strong ? 'bold' : 'regular',
    });
    lines.forEach((line, i) =>
      doc.text(right, y + i * 14, line, {
        align: 'right',
        size: r.strong ? 12 : 10,
        font: r.strong ? 'bold' : 'regular',
      }),
    );
    y += lines.length * 14 + 6;
  };

  newPage();
  for (const line of wrapText(q.title, 'bold', 18, width)) {
    doc.text(left, y, line, { font: 'bold', size: 18 });
    y += 24;
  }
  doc.text(left, y, `Reference ${q.reference}  -  Issued ${q.issued}`, { size: 10, color: MUTED });
  y += 24;

  const tone = TONE[q.validity.tone];
  const validityLines = wrapText(q.validity.text, 'bold', 12, width - 24);
  const boxHeight = validityLines.length * 16 + 18;
  doc.rect(left, y, width, boxHeight, tone.fill);
  validityLines.forEach((line, i) =>
    doc.text(left + 12, y + 10 + i * 16, line, { font: 'bold', size: 12, color: tone.text }),
  );
  y += boxHeight + 8;

  heading('Prepared for');
  q.preparedFor.forEach(row);
  heading('Your stay');
  q.stay.forEach(row);
  heading('Price');
  q.price.forEach(row);
  ensure(30);
  doc.line(left, y, right, y, INK, 1.2);
  y += 8;
  row(q.total);

  heading('Terms');
  for (const term of q.terms) {
    const lines = wrapText(term, 'regular', 10, width - 12);
    ensure(lines.length * 14 + 4);
    doc.text(left, y, '-', { size: 10, color: MUTED });
    lines.forEach((line, i) => doc.text(left + 12, y + i * 14, line, { size: 10 }));
    y += lines.length * 14 + 4;
  }

  doc.text(
    left,
    A4.height - 40,
    `Generated ${formatIst(generatedAt.toISOString())}  -  Quote ${quote.quote_id}`,
    {
      size: 8,
      color: MUTED,
    },
  );
  return doc.toBytes(generatedAt);
}
