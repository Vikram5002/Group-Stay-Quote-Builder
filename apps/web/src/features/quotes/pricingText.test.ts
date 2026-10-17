import type { QuoteRequest, QuoteTotals } from '@c32/core';
import { clientTotal, describePricing } from './pricingText';

const request = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  ...over,
});

const totals = (over: Partial<QuoteTotals> = {}) =>
  ({
    room_nights: 20,
    room_revenue_inr: 36000,
    inclusions_revenue_inr: 0,
    floor_rate_per_room_night_inr: 2000,
    ...over,
  }) as QuoteTotals;

describe('how a quote is priced, in words', () => {
  it('a % discount off the full price', () => {
    expect(describePricing(request({ discount_pct: 10 }), totals())).toEqual({
      rate: 1800,
      text: '₹2,000 full price, 10% off = ₹1,800 per room-night',
      discount: '10% off',
    });
  });

  it('a ₹ discount off the full price, never below 0', () => {
    expect(describePricing(request({ discount_inr: 200 }), totals())).toMatchObject({
      rate: 1800,
      discount: '₹200 off per room-night',
    });
    expect(describePricing(request({ discount_inr: 5000 }), totals()).rate).toBe(0);
  });

  it('a fixed rate, a zero discount, and the rate plan', () => {
    expect(describePricing(request({ rate_per_room_night_inr: 1750 }), totals()).text).toBe(
      '₹1,750 per room-night, a fixed rate (full price ₹2,000)',
    );
    expect(describePricing(request({ discount_pct: 0 }), totals()).text).toBe(
      '₹2,000 per room-night, the full price',
    );
    expect(describePricing(request(), totals()).text).toBe(
      'From the rate plan, on average ₹1,800 per room-night',
    );
    expect(describePricing(request(), totals({ room_revenue_inr: null })).text).toBe(
      'From the rate plan',
    );
  });

  it('the client total adds charged inclusions and stays unknown when a part is', () => {
    expect(clientTotal(totals({ inclusions_revenue_inr: 4000 }))).toBe(40000);
    expect(clientTotal(totals({ inclusions_revenue_inr: null }))).toBeNull();
  });
});
