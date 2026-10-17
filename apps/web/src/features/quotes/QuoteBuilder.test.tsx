import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createTestApi } from '../../mocks/server';
import { mockSession } from '../auth/auth';

const { server, store } = createTestApi(() => new Date('2026-10-20T06:00:00Z'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
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

function renderBuilder() {
  return render(
    <Providers initialSession={mockSession('Sales', 'Asha')} baseUrl="http://api.test">
      <RouterProvider router={createTestRouter(['/quotes/new'])} />
    </Providers>,
  );
}

const user = () => userEvent.setup();

async function fillGroup(u: ReturnType<typeof user>, name = 'Fictional Events Pvt Ltd') {
  await u.type(screen.getByLabelText(/Organiser name/), name);
  await u.type(screen.getByLabelText(/Check-in date/), '2026-11-01');
}

const next = (u: ReturnType<typeof user>) => u.click(screen.getByRole('button', { name: 'Next' }));

/** Walk to the review step with the given rooms, room type and rate. */
async function toReview(
  u: ReturnType<typeof user>,
  opts: { rooms?: string; roomType?: string; rate?: string } = {},
) {
  await fillGroup(u);
  await next(u);
  if (opts.roomType) await u.selectOptions(screen.getByLabelText(/Room type/), opts.roomType);
  if (opts.rooms) {
    await u.clear(screen.getByLabelText(/^Rooms/));
    await u.type(screen.getByLabelText(/^Rooms/), opts.rooms);
  }
  await next(u);
  if (opts.rate) await u.type(screen.getByLabelText(/Rate per room per night/), opts.rate);
  await next(u);
}

describe('quote builder: the three rubric flows', () => {
  it('fixture: 10 rooms, 2 nights, rate 2000 is offered and can be issued', async () => {
    const u = user();
    renderBuilder();
    await toReview(u, { rate: '2000' });

    expect(await screen.findByText('Ready to offer')).toBeInTheDocument();
    const totals = screen
      .getByRole('heading', { name: 'Totals' })
      .closest('section') as HTMLElement;
    expect(within(totals).getByText(/40,000/)).toBeInTheDocument();
    expect(within(totals).getByText(/24,000/)).toBeInTheDocument();
    expect(screen.getAllByText('Meets floor').length).toBeGreaterThan(0);
    expect(screen.getByText(/20 x 2000 = 40000 room revenue/)).toBeInTheDocument();

    // The button stays disabled while the server is still confirming the latest form.
    const issue = screen.getByRole('button', { name: 'Issue quote' });
    await waitFor(() => expect(issue).toBeEnabled());
    await u.click(issue);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' }),
    ).toBeInTheDocument();
    expect(store.quotes.size).toBe(1);
    expect([...store.quotes.values()][0]?.status).toBe('OFFERED');
  });

  it('shortage: 12 rooms when 10 are available is a partial offer, never an over-hold', async () => {
    const u = user();
    renderBuilder();
    await toReview(u, { rooms: '12', rate: '2000' });

    expect(await screen.findByText('Partial offer: 10 of 12 rooms')).toBeInTheDocument();
    expect(screen.getByText(/You are 2 short/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Change the request to 10 rooms' }));
    expect(await screen.findByText('Ready to offer')).toBeInTheDocument();
  });

  it('below the floor: review is required, and the suggested rate fixes it', async () => {
    const u = user();
    renderBuilder();
    await toReview(u, { rate: '1700' });

    expect(await screen.findByText('Owner review required')).toBeInTheDocument();
    expect(screen.getAllByText(/Below floor: review required/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Send for Owner review' })).toBeEnabled();

    await u.click(screen.getByRole('button', { name: 'Use rate 1800' }));
    expect(await screen.findByText('Ready to offer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue quote' })).toBeEnabled();
  });

  it('shows Unknown, never zero, when the cost is not known', async () => {
    const u = user();
    renderBuilder();
    await toReview(u, { roomType: 'deluxe', rooms: '2' });

    expect(await screen.findByText('Owner review required')).toBeInTheDocument();
    expect(screen.getByText(/A required cost is unknown/)).toBeInTheDocument();
    const totals = screen
      .getByRole('heading', { name: 'Totals' })
      .closest('section') as HTMLElement;
    expect(within(totals).getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Contribution: Unknown/ })).toBeInTheDocument();
  });
});

describe('quote builder: forms and live meter', () => {
  it('blocks Next with plain-language errors from the shared schema', async () => {
    const u = user();
    renderBuilder();
    await next(u);
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid date')).toBeInTheDocument();
    expect(screen.getByLabelText(/Organiser name/)).toHaveAttribute('aria-invalid', 'true');

    await fillGroup(u);
    await u.clear(screen.getByLabelText(/^Nights/));
    await u.type(screen.getByLabelText(/^Nights/), '40');
    await next(u);
    expect(screen.getByText('Must be between 1 and 28')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Group and dates' })).toBeInTheDocument();
  });

  it('updates the meter at once from the new rate, then the server confirms', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await next(u);
    // The plan rate is 2000, so the server answer arrives first.
    expect(await screen.findByText('Confirmed by the server.')).toBeInTheDocument();

    await u.type(screen.getByLabelText(/Rate per room per night/), '1700');
    expect(await screen.findByText(/Estimate from your rate/)).toBeInTheDocument();
    expect(screen.getAllByText(/Below floor: review required/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Confirmed by the server.')).toBeInTheDocument());
    expect(screen.getAllByText(/Below floor: review required/).length).toBeGreaterThan(0);
  });

  it('adds an inclusion with an unknown cost and sends it for review', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await next(u);
    await u.click(screen.getByRole('button', { name: 'Add inclusion' }));
    await u.type(screen.getByLabelText(/Inclusion 1 name/), 'Breakfast');
    await u.click(screen.getByLabelText('Cost is not known yet'));
    expect(screen.getByLabelText(/Cost to the hotel per unit/)).toBeDisabled();
    await next(u);
    expect(await screen.findByText('Owner review required')).toBeInTheDocument();
    expect(screen.getByText(/A required cost is unknown/)).toBeInTheDocument();
  });

  it('starts a fresh form when New quote is chosen again', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await next(u);
    expect(screen.getByRole('heading', { name: 'Rooms and type' })).toBeInTheDocument();

    await u.click(screen.getByRole('link', { name: 'New quote' }));
    expect(screen.getByRole('heading', { name: 'Group and dates' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('');
  });

  it('goes back without losing what was typed', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await next(u);
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Acme Offsite');
  });
});

describe('quote builder: accessibility (axe)', () => {
  it('has no violations on each step', async () => {
    const u = user();
    const { container } = renderBuilder();
    expect(await axe(container)).toHaveNoViolations();
    await fillGroup(u);
    await next(u);
    expect(await axe(container)).toHaveNoViolations();
    await next(u);
    expect(await axe(container)).toHaveNoViolations();
    await next(u);
    await screen.findByText('Ready to offer');
    expect(await axe(container)).toHaveNoViolations();
  });
});
