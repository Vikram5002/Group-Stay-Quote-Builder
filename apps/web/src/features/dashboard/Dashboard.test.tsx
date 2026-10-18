import { render, screen, within } from '@testing-library/react';
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

const create = (overrides: Partial<QuoteRequest>) =>
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

function renderDashboard(role: Role = 'Sales') {
  return render(
    <Providers initialSession={mockSession(role, 'Ravi')} baseUrl={BASE}>
      <RouterProvider router={createTestRouter(['/'])} />
    </Providers>,
  );
}

function pipelineCount(label: string): string {
  const section = screen.getByRole('heading', { name: 'Pipeline by status' }).closest('section');
  const item = within(section as HTMLElement)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(label, { selector: 'span' }));
  return (item?.querySelector('a > span')?.textContent ?? '').trim();
}

describe('dashboard', () => {
  it('guides a new user when there are no quotes', async () => {
    renderDashboard('Sales');
    expect(await screen.findByText('No quotes yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create the first quote' })).toHaveAttribute(
      'href',
      '/quotes/new',
    );
  });

  it('does not offer to create quotes to a Viewer', async () => {
    renderDashboard('Viewer');
    expect(await screen.findByText('No quotes yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create the first quote' })).not.toBeInTheDocument();
  });

  it('counts the pipeline by status and totals the contribution at risk without treating unknown as zero', async () => {
    await create({}); // offered, contribution 24000
    await create({ stay: { check_in: '2026-11-04', nights: 2 }, rate_per_room_night_inr: 1700 }); // review, 18000
    await create({ room_type: 'deluxe', rooms: 2, rate_per_room_night_inr: undefined }); // review, unknown cost
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Pipeline by status' })).toBeInTheDocument();
    expect(pipelineCount('Offered')).toBe('1');
    expect(pipelineCount('Pending review')).toBe('2');
    expect(pipelineCount('Confirmed')).toBe('0');
    // Each count opens the quotes list filtered to that status.
    expect(screen.getByRole('link', { name: /^1\s*Offered/ })).toHaveAttribute(
      'href',
      '/quotes?status=OFFERED',
    );

    const risk = screen
      .getByRole('heading', { name: 'Contribution at risk' })
      .closest('section') as HTMLElement;
    expect(within(risk).getByText(/42,000/)).toBeInTheDocument();
    expect(within(risk).getByText(/1 open quote has an unknown contribution/)).toBeInTheDocument();
  });

  it('lists holds that expire within 24 hours, soonest first', async () => {
    const soon = await create({});
    const later = await create({
      stay: { check_in: '2026-11-04', nights: 2 },
      organiser: { name: 'Later Group' },
    });
    const inTwoHours = new Date(Date.now() + 2 * 3_600_000).toISOString();
    store.quotes.set(soon.quote_id, { ...soon, valid_until: inTwoHours });
    expect(later.valid_until).not.toBeNull();
    renderDashboard();

    const card = (
      await screen.findByRole('heading', { name: 'Holds expiring in 24 hours' })
    ).closest('section') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Fictional Events Pvt Ltd' })).toHaveAttribute(
      'href',
      `/quotes/${soon.quote_id}`,
    );
    expect(within(card).getByText(/2h 00m left/)).toBeInTheDocument();
    expect(within(card).queryByText('Later Group')).not.toBeInTheDocument();
  });

  it('says when no holds are expiring soon', async () => {
    await create({});
    renderDashboard();
    expect(await screen.findByText(/No holds expire in the next 24 hours/)).toBeInTheDocument();
  });

  it('links recent quotes to their detail page', async () => {
    const quote = await create({});
    renderDashboard();
    const table = await screen.findByRole('table', { name: 'Most recent quotes' });
    expect(within(table).getByRole('link', { name: 'Fictional Events Pvt Ltd' })).toHaveAttribute(
      'href',
      `/quotes/${quote.quote_id}`,
    );
    expect(within(table).getByText(/24,000/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    await create({});
    const { container } = renderDashboard();
    await screen.findByRole('heading', { name: 'Pipeline by status' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('dashboard counts read as sentences', () => {
  it('one open quote is singular', async () => {
    await create({});
    renderDashboard();
    expect(
      await screen.findByText('Contribution on 1 open quote that is offered or pending review.', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^1 quote$/)).toBeInTheDocument();
  });

  it('two open quotes are plural', async () => {
    await create({ rooms: 2 });
    await create({ rooms: 3 });
    renderDashboard();
    expect(
      await screen.findByText('Contribution on 2 open quotes that are offered or pending review.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});
