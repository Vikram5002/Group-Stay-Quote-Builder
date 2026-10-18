import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatInZone, type Policy, type Quote } from '@c32/core';

/**
 * Quote and invoice PDFs (D-059): one standard A4 template with the hotel's details, the
 * organiser, every block of rooms and the price, full price first, then the discount, then the
 * total. The standard PDF fonts have no rupee sign, so amounts read "INR 40,000".
 */

export type DocumentKind = 'quote' | 'invoice';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.4, 0.45);
const RULE = rgb(0.85, 0.86, 0.88);

export const inr = (n: number | null) =>
  n === null ? 'Unknown' : `INR ${n.toLocaleString('en-IN')}`;

/** Document number shown on the PDF and in the email subject. */
export function documentNumber(kind: DocumentKind, quote: Quote): string {
  return `${kind === 'quote' ? 'Q' : 'INV'}-${quote.quote_id.slice(-10)}`;
}

/** The standard fonts only cover Latin-1; replace anything else so drawing never throws. */
const RUPEE = String.fromCharCode(0x20b9);
/** Printable ASCII and Latin-1 are the only characters the standard fonts can draw. */
const drawable = (code: number) => (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
const safe = (text: string) =>
  [...text.split(RUPEE).join('INR ')].map((c) => (drawable(c.charCodeAt(0)) ? c : '?')).join('');

class Writer {
  y = A4[1] - MARGIN;
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}

  text(
    value: string,
    opts: { size?: number; bold?: boolean; color?: typeof INK; x?: number } = {},
  ) {
    const size = opts.size ?? 10;
    this.page.drawText(safe(value), {
      x: opts.x ?? MARGIN,
      y: this.y,
      size,
      font: opts.bold ? this.bold : this.regular,
      color: opts.color ?? INK,
    });
  }

  /** A label on the left and a value right-aligned on the same line. */
  row(label: string, value: string, opts: { bold?: boolean } = {}) {
    this.text(label, { bold: opts.bold ?? false });
    const font = opts.bold ? this.bold : this.regular;
    const width = font.widthOfTextAtSize(safe(value), 10);
    this.text(value, { x: A4[0] - MARGIN - width, bold: opts.bold ?? false });
    this.down(16);
  }

  rule() {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 6 },
      end: { x: A4[0] - MARGIN, y: this.y + 6 },
      thickness: 0.7,
      color: RULE,
    });
    this.down(10);
  }

  down(by: number) {
    this.y -= by;
  }
}

export interface DocumentInput {
  kind: DocumentKind;
  quote: Quote;
  policy: Policy;
  /** When the document is produced, for the date printed on it. */
  nowMs: number;
}

export async function renderDocument({
  kind,
  quote,
  policy,
  nowMs,
}: DocumentInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${kind === 'quote' ? 'Quote' : 'Invoice'} ${documentNumber(kind, quote)}`);
  pdf.setAuthor(policy.hotel_name);
  pdf.setCreationDate(new Date(nowMs));
  const page = pdf.addPage(A4);
  const w = new Writer(
    page,
    await pdf.embedFont(StandardFonts.Helvetica),
    await pdf.embedFont(StandardFonts.HelveticaBold),
  );
  const t = quote.evaluation.totals;
  const tz = policy.timezone;
  const day = (instantMs: number) => formatInZone(instantMs, tz).slice(0, 10);

  // Hotel header.
  w.text(policy.hotel_name, { size: 20, bold: true });
  w.down(18);
  for (const line of [policy.hotel_address, policy.hotel_phone && `Phone ${policy.hotel_phone}`]) {
    if (line) {
      w.text(line, { color: MUTED });
      w.down(14);
    }
  }
  if (policy.hotel_gstin) {
    w.text(`GSTIN ${policy.hotel_gstin}`, { color: MUTED });
    w.down(14);
  }
  w.down(10);

  // Document title and details.
  w.text(kind === 'quote' ? 'GROUP STAY QUOTE' : 'INVOICE', { size: 16, bold: true });
  w.down(22);
  w.row(kind === 'quote' ? 'Quote number' : 'Invoice number', documentNumber(kind, quote));
  w.row('Date', day(nowMs));
  if (kind === 'quote' && quote.valid_until) {
    w.row(
      'Valid until',
      formatInZone(Date.parse(quote.valid_until), tz).replace('T', ' ').slice(0, 16),
    );
  }
  if (kind === 'invoice' && quote.payment) {
    w.row('Payment received', day(Date.parse(quote.payment.received_at)));
    if (quote.payment.reference) w.row('Payment reference', quote.payment.reference);
  }
  w.row('Quote reference', quote.quote_id);
  w.down(8);

  // Billed to.
  w.text(kind === 'quote' ? 'Prepared for' : 'Billed to', { bold: true });
  w.down(16);
  w.text(quote.request.organiser.name);
  w.down(14);
  if (quote.request.organiser.reference) {
    w.text(`Reference: ${quote.request.organiser.reference}`, { color: MUTED });
    w.down(14);
  }
  if (quote.request.organiser.email) {
    w.text(quote.request.organiser.email, { color: MUTED });
    w.down(14);
  }
  w.down(10);

  // Rooms.
  w.text('Rooms', { bold: true });
  w.down(16);
  const lines = quote.evaluation.lines ?? [
    {
      check_in: quote.evaluation.check_in,
      check_out: quote.evaluation.check_out,
      nights: quote.evaluation.nights,
      rooms: quote.evaluation.offered_rooms,
    },
  ];
  const roomType = quote.request.room_type;
  for (const line of lines) {
    w.row(
      `${line.rooms} ${roomType} room${line.rooms === 1 ? '' : 's'}, ${line.check_in} to ${line.check_out}`,
      `${line.nights} night${line.nights === 1 ? '' : 's'}`,
    );
  }
  for (const inc of quote.request.inclusions ?? []) {
    w.row(
      `Includes ${inc.name}`,
      inc.included_in_rate ? 'in the room rate' : `${inr(inc.price_inr ?? null)} per unit`,
    );
  }
  w.rule();

  // Price: full price, the discount, then what is payable.
  w.row(
    `Full price (${t.room_nights} room-nights x ${inr(t.floor_rate_per_room_night_inr)})`,
    inr(t.list_revenue_inr),
  );
  if (t.room_revenue_inr !== null) {
    const off = t.list_revenue_inr - t.room_revenue_inr;
    if (off > 0) w.row(`Discount (${t.discount_pct ?? 0}%)`, `- ${inr(off)}`);
    else if (off < 0) w.row('Rate above full price', `+ ${inr(-off)}`);
  }
  w.row('Room charges', inr(t.room_revenue_inr));
  if ((t.inclusions_revenue_inr ?? 0) > 0)
    w.row('Extras charged separately', inr(t.inclusions_revenue_inr));
  w.rule();
  const payable =
    t.room_revenue_inr === null || t.inclusions_revenue_inr === null
      ? null
      : t.room_revenue_inr + t.inclusions_revenue_inr;
  w.row(kind === 'quote' ? 'Total quoted' : 'Total paid', inr(payable), { bold: true });
  w.down(16);

  // Footer.
  for (const note of [
    'Amounts exclude tax.',
    kind === 'quote'
      ? 'Rooms are held until the time above. Confirm before then to keep them.'
      : 'Thank you for your booking.',
    'Case C32 demonstration: all data is synthetic.',
  ]) {
    w.text(note, { size: 9, color: MUTED });
    w.down(13);
  }
  return pdf.save();
}
