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

const clientFor = (user: string, role: Role) =>
  createApiClient({ baseUrl: BASE, getToken: () => makeMockToken({ user_id: user, role }) });

const belowFloor = (overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in: '2026-11-01', nights: 2 },
  room_type: 'standard',
  rooms: 10,
  rate_per_room_night_inr: 1700,
  ...overrides,
});

const seed = (overrides: Partial<QuoteRequest> = {}, creator = 'asha'): Promise<Quote> =>
  clientFor(creator, 'Sales').createQuote(belowFloor(overrides), {
    idempotencyKey: newIdempotencyKey(),
  });

function renderQueue(role: Role = 'Owner', name = 'Meera', path = '/review') {
  return render(
    <Providers initialSession={mockSession(role, name)} baseUrl={BASE}>
      <RouterProvider router={createTestRouter([path])} />
    </Providers>,
  );
}

describe('review queue', () => {
  it('guides the Owner when nothing is waiting', async () => {
    renderQueue();
    expect(await screen.findByText('Nothing is waiting for review')).toBeInTheDocument();
  });

  it('is for Owners only', () => {
    renderQueue('Sales', 'Ravi');
    expect(screen.getByRole('heading', { level: 1, name: 'Not allowed' })).toBeInTheDocument();
  });

  it('lists quotes needing a decision with their reasons, most urgent first', async () => {
    const later = await seed({
      organiser: { name: 'Later Group' },
      stay: { check_in: '2026-11-04', nights: 2 },
    });
    const sooner = await seed({
      organiser: { name: 'Sooner Group' },
      stay: { check_in: '2026-11-07', nights: 2 },
    });
    store.quotes.set(sooner.quote_id, {
      ...sooner,
      valid_until: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    });
    expect(later.status).toBe('PENDING_REVIEW');
    renderQueue();

    const queue = await screen.findByRole('navigation', { name: 'Quotes awaiting review' });
    const buttons = within(queue).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Sooner Group');
    expect(buttons[1]).toHaveTextContent('Later Group');
    expect(within(buttons[0] as HTMLElement).getByText('Below floor')).toBeInTheDocument();
  });

  it('shows the requested terms next to the floor-safe alternative', async () => {
    await seed();
    renderQueue();

    const table = await screen.findByRole('table', {
      name: /Requested terms compared with floor-safe alternatives/,
    });
    expect(within(table).getByRole('columnheader', { name: 'As requested' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Raise the rate' })).toBeInTheDocument();
    const rate = within(table).getByRole('row', { name: /Rate per room-night/ });
    expect(rate).toHaveTextContent(/1,700/);
    expect(rate).toHaveTextContent(/1,800/);
    const contribution = within(table).getByRole('row', { name: /^Contribution/ });
    expect(contribution).toHaveTextContent(/18,000/);
    expect(contribution).toHaveTextContent(/20,000/);
  });

  it('says plainly when the contribution is unknown, never as zero', async () => {
    await seed({ room_type: 'deluxe', rooms: 2, rate_per_room_night_inr: undefined });
    renderQueue();
    expect(await screen.findByText('The contribution is unknown')).toBeInTheDocument();
    expect(screen.getAllByText('Cost unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });
});

describe('approving and rejecting', () => {
  it('approves with a required reason, bound to the terms, and Sales can then confirm', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderQueue();

    await u.click(await screen.findByRole('button', { name: 'Approve…' }));
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Approve quote' }));
    expect(
      within(dialog).getByText('Enter at least 5 characters explaining why.'),
    ).toBeInTheDocument();

    await u.type(within(dialog).getByLabelText(/Reason/), 'ok');
    await u.click(within(dialog).getByRole('button', { name: 'Approve quote' }));
    expect(
      within(dialog).getByText('Enter at least 5 characters explaining why.'),
    ).toBeInTheDocument();
    expect(store.quotes.get(quote.quote_id)?.status).toBe('PENDING_REVIEW');

    await u.clear(within(dialog).getByLabelText(/Reason/));
    await u.type(within(dialog).getByLabelText(/Reason/), 'Repeat client, strategic account');
    await u.click(within(dialog).getByRole('button', { name: 'Approve quote' }));

    expect(await screen.findByText('Quote approved')).toBeInTheDocument();
    const saved = store.quotes.get(quote.quote_id);
    expect(saved?.status).toBe('OFFERED');
    expect(saved?.approval?.approved_by.user_id).toBe('meera');
    expect(saved?.approval?.reason).toBe('Repeat client, strategic account');
    expect(saved?.approval?.terms_hash).toBe(saved?.terms_hash);
    expect(await screen.findByText('Nothing is waiting for review')).toBeInTheDocument();

    const confirmed = await clientFor('asha', 'Sales').confirmQuote(quote.quote_id, {
      idempotencyKey: newIdempotencyKey(),
    });
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('blocks approving your own quote but allows rejecting it', async () => {
    const quote = await seed({}, 'asha');
    const u = userEvent.setup();
    renderQueue('Owner', 'Asha');

    const approve = await screen.findByRole('button', { name: 'Approve…' });
    expect(approve).toBeDisabled();
    expect(
      screen.getByText(/You created this quote, so someone else must approve it/),
    ).toBeInTheDocument();
    expect(approve).toHaveAccessibleDescription(/someone else must approve it/);

    await u.click(screen.getByRole('button', { name: 'Reject…' }));
    await u.type(
      within(screen.getByRole('dialog')).getByLabelText(/Reason/),
      'Entered at the wrong rate',
    );
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject quote' }));
    expect(await screen.findByText('Quote rejected')).toBeInTheDocument();
    expect(store.quotes.get(quote.quote_id)?.status).toBe('REJECTED');
  });

  it('rejects, releases the held rooms and records the reason', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderQueue();

    await u.click(await screen.findByRole('button', { name: 'Reject…' }));
    const dialog = screen.getByRole('dialog');
    await u.type(within(dialog).getByLabelText(/Reason/), 'Rate too low for the season');
    await u.click(within(dialog).getByRole('button', { name: 'Reject quote' }));

    expect(await screen.findByText('Quote rejected')).toBeInTheDocument();
    expect(store.quotes.get(quote.quote_id)?.status).toBe('REJECTED');
    const night = store.inventory.find(
      (r) => r.date === '2026-11-01' && r.room_type === 'standard',
    );
    expect(night?.available_units).toBe(10);
    expect(store.events.at(-1)?.reason).toBe('Rate too low for the season');
  });

  it('explains a server refusal inside the dialog and keeps what was typed', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderQueue();

    await u.click(await screen.findByRole('button', { name: 'Approve…' }));
    // Someone else cancels it after this page loaded.
    store.quotes.set(quote.quote_id, { ...quote, status: 'CANCELLED' });
    const dialog = screen.getByRole('dialog');
    await u.type(within(dialog).getByLabelText(/Reason/), 'Repeat client, strategic account');
    await u.click(within(dialog).getByRole('button', { name: 'Approve quote' }));

    expect(await within(dialog).findByText('Could not approve the quote')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Only a PENDING_REVIEW quote can be reviewed, not CANCELLED'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue('Repeat client, strategic account');
  });

  it('opens the quote chosen from the detail page', async () => {
    await seed({ organiser: { name: 'Other Group' }, stay: { check_in: '2026-11-04', nights: 2 } });
    const target = await seed({
      organiser: { name: 'Chosen Group' },
      stay: { check_in: '2026-11-07', nights: 2 },
    });
    renderQueue('Owner', 'Meera', `/review?quote=${target.quote_id}`);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Chosen Group' }),
    ).toBeInTheDocument();
  });

  it('is reachable from a pending quote for an Owner', async () => {
    const quote = await seed();
    renderQueue('Owner', 'Meera', `/quotes/${quote.quote_id}`);
    const link = await screen.findByRole('link', { name: 'Review this quote' });
    expect(link).toHaveAttribute('href', `/review?quote=${quote.quote_id}`);
  });

  it('says so when a linked quote is no longer waiting, and shows the queue', async () => {
    const waiting = await seed({ organiser: { name: 'Still Waiting' } });
    const gone = await seed({
      organiser: { name: 'Gone Group' },
      stay: { check_in: '2026-11-04', nights: 2 },
    });
    await clientFor('asha', 'Sales').cancelQuote(
      gone.quote_id,
      {},
      {
        idempotencyKey: newIdempotencyKey(),
      },
    );
    renderQueue('Owner', 'Meera', `/review?quote=${gone.quote_id}`);
    expect(
      await screen.findByText('That quote is no longer waiting for review'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open it to see what happened' })).toHaveAttribute(
      'href',
      `/quotes/${gone.quote_id}`,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Still Waiting' })).toBeInTheDocument();
    expect(waiting.status).toBe('PENDING_REVIEW');
  });

  it('sorts by how far below the floor, and focuses the quote chosen', async () => {
    await seed({ organiser: { name: 'Small Gap' } });
    await seed({
      organiser: { name: 'Big Gap' },
      stay: { check_in: '2026-11-04', nights: 2 },
      rate_per_room_night_inr: 1400,
    });
    const u = userEvent.setup();
    renderQueue();
    const queue = await screen.findByRole('navigation', { name: 'Quotes awaiting review' });
    expect(screen.getByText('2 quotes are waiting')).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Sort'), 'shortfall');
    const buttons = within(queue).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Big Gap');
    expect(buttons[0]).toHaveTextContent(/below the floor/);

    await u.click(buttons[1] as HTMLElement);
    expect(screen.getByRole('heading', { level: 2, name: 'Small Gap' })).toHaveFocus();
    expect(screen.getByText(/₹1,700 per room-night, a fixed rate/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    await seed();
    const { container } = renderQueue();
    await screen.findByRole('button', { name: 'Approve…' });
    await waitFor(async () => expect(await axe(container)).toHaveNoViolations());
  });
});
