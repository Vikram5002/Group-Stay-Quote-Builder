import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import type { Quote, QuoteRequest, Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { makeMockToken } from '../../mocks/auth';
import { createTestApi } from '../../mocks/server';
import { mockSession } from '../auth/auth';

const BASE = 'http://api.test';
const { server, store } = createTestApi();

beforeAll(() => {
  // Pin the date (not the timers) so the case dates in November 2026 stay in the future.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
  vi.useRealTimers();
});
afterEach(() => server.resetHandlers());
beforeEach(() => {
  store.quotes.clear();
  store.events.length = 0;
  store.idempotency.clear();
  for (const row of store.inventory) {
    if (row.total_units !== null) {
      row.available_units = row.total_units;
      row.held_units = 0;
      row.confirmed_units = 0;
    }
  }
});

const request = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  rate_per_room_night_inr: 2000,
  ...overrides,
});

function seed(overrides: Partial<QuoteRequest> = {}, creator = 'asha'): Promise<Quote> {
  const client = createApiClient({
    baseUrl: BASE,
    getToken: () => makeMockToken({ user_id: creator, role: 'Sales' }),
  });
  return client.createQuote(request(overrides), { idempotencyKey: newIdempotencyKey() });
}

function renderDetail(id: string, role: Role = 'Sales', name = 'Ravi') {
  return render(
    <Providers initialSession={mockSession(role, name)} baseUrl={BASE}>
      <RouterProvider router={createTestRouter([`/quotes/${id}`])} />
    </Providers>,
  );
}

describe('quote detail', () => {
  it('shows the result, arithmetic trail, countdown and audit timeline', async () => {
    const quote = await seed();
    renderDetail(quote.quote_id);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Offered').length).toBeGreaterThan(0);
    expect(screen.getByText('Ready to offer')).toBeInTheDocument();

    const totals = screen
      .getByRole('heading', { name: 'Totals' })
      .closest('section') as HTMLElement;
    // Full price, the discount taken off, then what the organiser pays.
    expect(
      within(totals).getByText(/Full price \(20 room-nights x ₹2,000\)/).nextSibling,
    ).toHaveTextContent('40,000');
    expect(within(totals).getByText('Discount (0%)')).toBeInTheDocument();
    expect(within(totals).getByText('Room revenue after discount').nextSibling).toHaveTextContent(
      '40,000',
    );
    expect(within(totals).getAllByText(/24,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/20 x 2000 = 40000 room revenue/)).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Hold countdown' })).toBeInTheDocument();
    expect(screen.getByText(/2d 23h left|3d 0h left/)).toBeInTheDocument();
    expect(screen.getByText(/after that they are released automatically/i)).toBeInTheDocument();

    const timeline = (await screen.findByRole('heading', { name: 'Audit timeline' })).closest(
      'section',
    ) as HTMLElement;
    await within(timeline).findByText('Quote created');
    expect(within(timeline).getByText('Rooms held')).toBeInTheDocument();
  });

  it('confirms and waits for the server, with a single confirm event', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Confirm quote' }));
    await waitFor(() => expect(store.quotes.get(quote.quote_id)?.status).toBe('CONFIRMED'));
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Confirm quote' })).not.toBeInTheDocument();
    expect(store.events.filter((e) => e.type === 'CONFIRMED')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Hold countdown' })).not.toBeInTheDocument();
  });

  it('extends validity and checks the hours', async () => {
    const quote = await seed();
    const before = quote.valid_until as string;
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Extend validity' }));
    const hours = screen.getByLabelText('Extra hours');
    await u.clear(hours);
    await u.type(hours, '0');
    await u.click(screen.getByRole('button', { name: 'Extend' }));
    expect(screen.getByText('Must be between 1 and 720')).toBeInTheDocument();

    await u.clear(hours);
    await u.type(hours, '24');
    await u.click(screen.getByRole('button', { name: 'Extend' }));
    await waitFor(() => expect(store.quotes.get(quote.quote_id)?.version).toBe(2));
    const after = store.quotes.get(quote.quote_id)?.valid_until as string;
    expect(Date.parse(after) - Date.parse(before)).toBe(24 * 3_600_000);
    expect(await screen.findByText('Validity extended')).toBeInTheDocument();
  });

  it('cancels after a confirmation dialog and releases the rooms', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Cancel quote' }));
    expect(screen.getByRole('heading', { name: 'Cancel this quote?' })).toBeInTheDocument();
    await u.type(screen.getByLabelText(/Reason/), 'Client changed plans');
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Cancel quote' }));

    await waitFor(() => expect(store.quotes.get(quote.quote_id)?.status).toBe('CANCELLED'));
    expect(await screen.findByText('Reason: Client changed plans')).toBeInTheDocument();
    const night = store.inventory.find(
      (r) => r.date === '2026-11-01' && r.room_type === 'standard',
    );
    expect(night?.available_units).toBe(10);
  });

  it('is read-only for a Viewer, who can still download the JSON', async () => {
    const quote = await seed();
    renderDetail(quote.quote_id, 'Viewer', 'Vik');
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    expect(screen.getByText(/can view this quote but not change it/)).toBeInTheDocument();
    for (const name of ['Confirm quote', 'Extend validity', 'Cancel quote']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument();
  });

  it('shows that an Owner must approve a pending-review quote', async () => {
    const quote = await seed({ rate_per_room_night_inr: 1700 });
    renderDetail(quote.quote_id);
    expect(await screen.findByText('Waiting for Owner approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm quote' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);
  });

  it('says so when the quote does not exist', async () => {
    renderDetail('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quote not found' }),
    ).toBeInTheDocument();
  });

  it('shows an expired quote with a way to start again', async () => {
    const quote = await seed();
    store.quotes.set(quote.quote_id, { ...quote, valid_until: '2020-01-01T00:00:00.000Z' });
    renderDetail(quote.quote_id);
    expect(await screen.findByText('This quote expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a new quote' })).toHaveAttribute(
      'href',
      '/quotes/new',
    );
    expect(screen.queryByRole('button', { name: 'Confirm quote' })).not.toBeInTheDocument();
  });

  it('turns a server refusal into a plain message and refreshes the quote', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);
    const confirm = await screen.findByRole('button', { name: 'Confirm quote' });

    // The hold lapses after the page loaded.
    store.quotes.set(quote.quote_id, { ...quote, valid_until: '2020-01-01T00:00:00.000Z' });
    await u.click(confirm);

    expect(await screen.findByText('Quote has expired')).toBeInTheDocument();
    expect(screen.getByText(/Re-quote to hold the rooms again/)).toBeInTheDocument();
    expect(await screen.findByText('This quote expired')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const quote = await seed();
    const { container } = renderDetail(quote.quote_id);
    await screen.findByRole('heading', { name: 'Audit timeline' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
