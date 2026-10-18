import { render, screen, waitFor, within } from '@testing-library/react';
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
  vi.useRealTimers();
});
afterEach(() => server.resetHandlers());
beforeEach(async () => {
  store.quotes.clear();
  for (const row of store.inventory) {
    if (row.total_units !== null) {
      row.available_units = row.total_units;
      row.held_units = 0;
      row.confirmed_units = 0;
    }
  }
  await create('ravi', { organiser: { name: 'Fictional Events Pvt Ltd', reference: 'FE-1' } });
  await create('ravi', {
    organiser: { name: 'Discount Group' },
    stay: { check_in: '2026-11-04', nights: 2 },
    discount_pct: 15,
  });
  await create('asha', {
    organiser: { name: 'Big Group', contact_name: 'Kiran Shah' },
    stay: { check_in: '2026-11-06', nights: 2 },
    rooms: 8,
  });
});

function create(user: string, over: Partial<QuoteRequest>) {
  const client = createApiClient({
    baseUrl: BASE,
    getToken: () => makeMockToken({ user_id: user, role: 'Sales' }),
  });
  return client.createQuote(
    {
      organiser: { name: 'x' },
      stay: { check_in: '2026-11-01', nights: 2 },
      room_type: 'standard',
      rooms: 10,
      discount_pct: 0,
      ...over,
    },
    { idempotencyKey: newIdempotencyKey() },
  );
}

function renderPage(path = '/quotes', role: Role = 'Sales') {
  return render(
    <Providers initialSession={mockSession(role, 'Ravi')} baseUrl={BASE}>
      <RouterProvider router={createTestRouter([path])} />
    </Providers>,
  );
}

/** Organiser names in the table, in order. */
const names = () =>
  within(screen.getByRole('table', { name: 'Quotes' }))
    .getAllByRole('link')
    .map((l) => l.textContent);

describe('the quotes list', () => {
  it('lists every quote with its status, stay, total and hold', async () => {
    renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(screen.getByText('3 quotes')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Quotes' });
    const row = within(table).getByRole('link', { name: 'Big Group' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Fri 06 Nov to Sun 08 Nov')).toBeInTheDocument();
    expect(within(row).getByText('₹32,000')).toBeInTheDocument();
    expect(within(row).getByText(/left$/)).toBeInTheDocument();
  });

  it('finds quotes by organiser, reference or contact', async () => {
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await u.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiran');
    expect(names()).toEqual(['Big Group']);
    expect(screen.getByText('1 quote match')).toBeInTheDocument();
    await u.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await u.type(screen.getByRole('searchbox', { name: 'Search' }), 'FE-1');
    expect(names()).toEqual(['Fictional Events Pvt Ltd']);
  });

  it('filters by status from the address, so the dashboard can link to it', async () => {
    renderPage('/quotes?status=PENDING_REVIEW');
    await waitFor(() => expect(names()).toEqual(['Discount Group']));
    expect(screen.getByLabelText('Status')).toHaveValue('PENDING_REVIEW');
  });

  it('shows only my quotes, and sorts by total', async () => {
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await u.selectOptions(screen.getByLabelText('Sort'), 'total');
    expect(names()).toEqual(['Fictional Events Pvt Ltd', 'Discount Group', 'Big Group']);
    await u.click(screen.getByLabelText('Only quotes I created'));
    expect(names()).toEqual(['Fictional Events Pvt Ltd', 'Discount Group']);
  });

  it('says so when nothing matches, with a way back', async () => {
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await u.type(screen.getByRole('searchbox', { name: 'Search' }), 'nobody');
    expect(screen.getByText('No quotes match these filters')).toBeInTheDocument();
    await u.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);
    expect(names()).toHaveLength(3);
  });

  it('keeps Quotes marked in the menu on a quote of its own', async () => {
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await u.click(
      within(screen.getByRole('table', { name: 'Quotes' })).getByRole('link', {
        name: 'Big Group',
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Big Group' });
    const menu = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(menu).getByRole('link', { name: 'Quotes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});
