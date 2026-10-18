import type { Quote, QuoteRequest } from '@c32/core';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { makeMockToken } from '../../mocks/auth';
import { createTestApi } from '../../mocks/server';
import { quotation, quotationFileName, quotationPdf, quotationText } from './quotation';

const BASE = 'http://api.test';
const { server, store } = createTestApi(() => new Date('2026-10-20T06:00:00Z'));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  // Each test issues the same rooms, so start every test with them free.
  store.quotes.clear();
  for (const row of store.inventory) {
    if (row.total_units !== null) {
      row.available_units = row.total_units;
      row.held_units = 0;
      row.confirmed_units = 0;
    }
  }
});

const client = createApiClient({
  baseUrl: BASE,
  getToken: () => makeMockToken({ user_id: 'asha', role: 'Reception' }),
});

const issue = (over: Partial<QuoteRequest> = {}): Promise<Quote> =>
  client.createQuote(
    {
      organiser: {
        name: 'Fictional Events Pvt Ltd',
        reference: 'FE-2026-11',
        contact_name: 'Priya Rao',
        email: 'priya@fictional.example',
      },
      stay: { check_in: '2026-11-08', nights: 2 },
      room_type: 'standard',
      rooms: 10,
      discount_pct: 10,
      inclusions: [
        {
          name: 'Breakfast',
          basis: 'per_guest_night',
          unit_cost_inr: 150,
          included_in_rate: false,
          price_inr: 300,
        },
      ],
      ...over,
    },
    { idempotencyKey: newIdempotencyKey() },
  );

const pdfText = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const INTERNAL = /contribution|variable cost|floor|margin|headroom|shortfall/i;

describe('the quotation for the organiser', () => {
  it('has the terms, the price after the discount and the validity date', async () => {
    const quote = await issue();
    const q = quotation(quote);
    expect(q.title).toBe('Quotation for Fictional Events Pvt Ltd');
    expect(q.validity).toEqual({
      tone: 'ok',
      text: expect.stringMatching(/^Valid until 23 Oct 2026, /),
    });
    expect(q.preparedFor).toContainEqual({ label: 'Contact', value: 'Priya Rao' });
    expect(q.stay).toContainEqual({ label: 'Check-in', value: 'Sun 08 Nov 2026' });
    expect(q.stay).toContainEqual({ label: 'Rooms', value: '10 rooms' });
    expect(q.price).toEqual(
      expect.arrayContaining([
        { label: 'Full price per room-night', value: '₹2,000' },
        { label: 'Discount', value: '10% off' },
        { label: 'Rate per room-night', value: '₹1,800' },
        { label: 'Room charges', value: '₹36,000' },
        { label: 'Breakfast', value: '₹300 per guest per night, charged separately' },
        { label: 'Extras charged separately', value: '₹12,000' },
      ]),
    );
    expect(q.total).toEqual({ label: 'Total', value: '₹48,000', strong: true });
  });

  it('never shows the hotel’s costs, contribution or floor', async () => {
    const quote = await issue({ discount_pct: 15, inclusions: undefined }); // needs review, so there is a shortfall
    expect(JSON.stringify(quotation(quote))).not.toMatch(INTERNAL);
    expect(pdfText(quotationPdf(quote))).not.toMatch(INTERNAL);
    expect(quotationText(quote)).not.toMatch(INTERNAL);
  });

  it('is a real PDF with the same content, and a readable file name', async () => {
    const quote = await issue();
    const pdf = pdfText(quotationPdf(quote, new Date('2026-10-20T06:00:00Z')));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    for (const text of [
      'Quotation for Fictional Events Pvt Ltd',
      'Valid until 23 Oct 2026',
      'Rs. 48,000',
      'Sun 08 Nov 2026',
      'priya@fictional.example',
    ]) {
      expect(pdf).toContain(text);
    }
    expect(quotationFileName(quote)).toBe('quotation-fictional-events-pvt-ltd-2026-11-08.pdf');
  });

  it('says when it is pending approval or no longer valid', async () => {
    const pending = await issue({ discount_pct: 15, inclusions: undefined });
    expect(quotation(pending).validity.tone).toBe('pending');
    expect(quotation({ ...pending, status: 'EXPIRED' }).validity).toMatchObject({
      tone: 'closed',
      text: expect.stringMatching(/^Expired .*no longer valid$/),
    });
    expect(quotation({ ...pending, status: 'EXPIRED' }).terms.join(' ')).not.toMatch(/held/);
  });

  it('as text, ready to paste into an email', async () => {
    const text = quotationText(await issue());
    expect(text.split('\n')[0]).toMatch(/^Quotation for Fictional Events Pvt Ltd \(ref \w{8}\)$/);
    expect(text).toContain('Rate per room-night: ₹1,800');
    expect(text).toContain('Total: ₹48,000');
  });
});
