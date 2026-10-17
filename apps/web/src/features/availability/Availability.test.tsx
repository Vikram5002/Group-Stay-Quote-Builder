import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import type { QuoteRequest, Role } from '@c32/core';
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

const sales = createApiClient({
  baseUrl: BASE,
  getToken: () => makeMockToken({ user_id: 'asha', role: 'Sales' }),
});

const create = (overrides: Partial<QuoteRequest> = {}) =>
  sales.createQuote(
    {
      organiser: { name: 'Fictional Events Pvt Ltd' },
      stay: { check_in: '2026-11-01', nights: 2 },
      room_type: 'standard',
      rooms: 10,
      rate_per_room_night_inr: 2000,
      ...overrides,
    },
    { idempotencyKey: newIdempotencyKey() },
  );

function renderPage(role: Role = 'Viewer') {
  return render(
    <Providers initialSession={mockSession(role, 'Vik')} baseUrl={BASE}>
      <RouterProvider router={createTestRouter(['/availability'])} />
    </Providers>,
  );
}

const night = (pattern: RegExp) => screen.findByRole('button', { name: pattern });

describe('availability calendar', () => {
  it('shows each night with available, held and confirmed room counts', async () => {
    renderPage();
    expect(await night(/\b0?1 Nov.*10 of 10 free.*Held 0.*Confirmed 0/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: false }).length).toBe(14);
  });

  it('shows held rooms and then confirmed rooms, kept apart', async () => {
    const quote = await create();
    const { unmount } = renderPage();
    expect(await night(/\b0?1 Nov.*0 of 10 free.*Held 10.*Confirmed 0/)).toBeInTheDocument();
    unmount();

    await sales.confirmQuote(quote.quote_id, { idempotencyKey: newIdempotencyKey() });
    renderPage();
    expect(await night(/\b0?1 Nov.*0 of 10 free.*Held 0.*Confirmed 10/)).toBeInTheDocument();
    expect(await night(/\b0?3 Nov.*10 of 10 free.*Held 0.*Confirmed 0/)).toBeInTheDocument();
  });

  it('shows a night with unknown availability as Unknown, never as zero', async () => {
    renderPage();
    const unknown = await night(/10 Nov.*Unknown/);
    expect(within(unknown).getByText('Unknown')).toBeInTheDocument();
    expect(unknown).not.toHaveTextContent(/0 of/);
  });

  it('lists the quotes holding a night when it is chosen', async () => {
    const quote = await create({ organiser: { name: 'Holding Group' } });
    const u = userEvent.setup();
    renderPage();

    await u.click(await night(/\b0?1 Nov.*Held 10/));
    const detail = (await screen.findByRole('heading', { name: /Night of/ })).closest(
      'section',
    ) as HTMLElement;
    expect(
      within(detail).getByText(/10 rooms = 0 available \+ 10 held \+ 0 confirmed/),
    ).toBeInTheDocument();
    const link = await within(detail).findByRole('link', { name: 'Holding Group' });
    expect(link).toHaveAttribute('href', `/quotes/${quote.quote_id}`);

    await u.click(await night(/\b0?5 Nov.*10 of 10 free/));
    expect(await screen.findByText('No quote holds rooms on this night.')).toBeInTheDocument();
  });

  it('explains a night with unknown availability when chosen', async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(await night(/10 Nov.*Unknown/));
    expect(await screen.findByText(/no rooms can be held on it/)).toBeInTheDocument();
  });

  it('switches room type', async () => {
    const u = userEvent.setup();
    renderPage();
    await night(/\b0?1 Nov.*10 of 10 free/);
    await u.selectOptions(screen.getByLabelText('Room type'), 'deluxe');
    expect(await night(/\b0?1 Nov.*4 of 4 free/)).toBeInTheDocument();
  });

  it('checks the date range before asking the server', async () => {
    const u = userEvent.setup();
    renderPage();
    await night(/\b0?1 Nov/);
    const last = screen.getByLabelText('Last night');
    await u.clear(last);
    await u.type(last, '2026-10-01');
    expect(
      screen.getByText('The last night must be on or after the first night.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0);

    await u.clear(last);
    await u.type(last, '2027-03-01');
    expect(screen.getByText('Choose at most 45 nights.')).toBeInTheDocument();
  });

  it('says so when nothing is on sale for the range', async () => {
    const u = userEvent.setup();
    renderPage();
    await night(/\b0?1 Nov/);
    const first = screen.getByLabelText('First night');
    const last = screen.getByLabelText('Last night');
    await u.clear(last);
    await u.type(last, '2026-12-31');
    await u.clear(first);
    await u.type(first, '2026-12-01');
    expect(await screen.findByText('No inventory for these dates')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await night(/\b0?1 Nov/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
