import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createTestApi } from '../../mocks/server';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { makeMockToken } from '../../mocks/auth';
import { mockSession } from '../auth/auth';
import { initialForm, newInclusion } from './form';

const { server, store } = createTestApi(() => new Date('2026-10-20T06:00:00Z'));

beforeAll(() => {
  // Pin the date (not the timers) to the mock server's day, so "today" is 20 Oct 2026 in IST.
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
  sessionStorage.clear();
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

function renderBuilder(path = '/quotes/new') {
  const router = createTestRouter([path]);
  const view = render(
    <Providers initialSession={mockSession('Sales', 'Asha')} baseUrl="http://api.test">
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router };
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
  if (opts.rate) await u.type(screen.getByLabelText(/fixed rate per room-night/), opts.rate);
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
    // Full price, the discount taken off, then what the organiser pays.
    expect(
      within(totals).getByText(/Full price \(20 room-nights x ₹2,000\)/).nextSibling,
    ).toHaveTextContent('40,000');
    expect(within(totals).getByText('Discount (0%)')).toBeInTheDocument();
    expect(within(totals).getByText('Room revenue after discount').nextSibling).toHaveTextContent(
      '40,000',
    );
    expect(within(totals).getAllByText(/24,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Within the Sales limit').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/Over the limit: owner review/).length).toBeGreaterThan(0);
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
    expect(
      screen.getAllByText(/A cost is unknown, so the price cannot be checked yet/).length,
    ).toBeGreaterThan(0);
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

    await u.type(screen.getByLabelText(/fixed rate per room-night/), '1700');
    expect(await screen.findByText(/Estimate from your rate/)).toBeInTheDocument();
    expect(screen.getAllByText(/Over the limit: owner review/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Confirmed by the server.')).toBeInTheDocument());
    expect(screen.getAllByText(/Over the limit: owner review/).length).toBeGreaterThan(0);
  });

  it('Sales prices by a discount: within the limit is fine, over it goes to the owner', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await next(u);
    const discount = screen.getByLabelText(/Discount off full price/);
    await u.clear(discount);
    await u.type(discount, '5');
    await waitFor(() => expect(screen.getByText('Confirmed by the server.')).toBeInTheDocument());
    expect(screen.getAllByText('Within the Sales limit').length).toBeGreaterThan(0);
    expect(screen.getByText('5%')).toBeInTheDocument();
    const card = screen.getByRole('complementary', { name: 'Live price check' });
    // 10 rooms x 2 nights: 24000 at full price; 5% off takes 2000, leaving 22000.
    expect(within(card).getByText('Contribution before discount').nextSibling).toHaveTextContent(
      '24,000',
    );
    expect(
      within(card).getByText('Contribution after discount', { selector: 'dt' }).nextSibling,
    ).toHaveTextContent('22,000');

    await u.clear(discount);
    await u.type(discount, '15');
    await waitFor(() => expect(screen.getByText('15%')).toBeInTheDocument());
    expect(screen.getAllByText(/Over the limit: owner review/).length).toBeGreaterThan(0);
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

  it('an inclusion charged on top needs its price, and the calculation matches what was typed', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await next(u);
    await u.type(screen.getByLabelText(/fixed rate per room-night/), '2000');
    await u.click(screen.getByRole('button', { name: 'Add inclusion' }));
    await u.type(screen.getByLabelText(/Inclusion 1 name/), 'Breakfast');
    await u.type(screen.getByLabelText(/Cost to the hotel per unit/), '150');
    await u.click(screen.getByLabelText('Already included in the room rate'));

    // Blank is not 0: the price must be typed.
    const price = screen.getByLabelText(/Extra price charged per unit/);
    expect(
      screen.getByText('Enter the extra price, or 0 if there is no extra charge'),
    ).toBeInTheDocument();
    expect(price).toHaveAttribute('aria-invalid', 'true');
    await next(u);
    expect(screen.getByRole('heading', { name: 'Inclusions' })).toBeInTheDocument();

    await u.type(price, '200');
    await next(u);
    expect(
      await screen.findByText(
        /Breakfast: .* = 6000 cost, charged separately 40 x 200 = 8000 revenue/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/included in the rate/)).not.toBeInTheDocument();
  });

  it('starts a fresh form when New quote is chosen again', async () => {
    const u = user();
    renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await next(u);
    expect(screen.getByRole('heading', { name: 'Rooms and type' })).toBeInTheDocument();

    await u.click(screen.getByRole('link', { name: 'New quote' }));
    // What was typed is kept as a draft, so starting again is a choice.
    await u.click(await screen.findByRole('button', { name: 'Start over' }));
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

describe('quote builder: the live meter never shows stale numbers as confirmed', () => {
  const meter = () => screen.getByRole('complementary', { name: 'Live price check' });
  const rateField = () => screen.getByLabelText(/fixed rate per room-night/);

  /** Step 3 with the rate at 1500: revenue after discount 20 room-nights x 1500 = 30000. */
  async function atRate1500(u: ReturnType<typeof user>) {
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await next(u);
    await u.type(rateField(), '1500');
    await waitFor(() =>
      expect(within(meter()).getByText('Confirmed by the server.')).toBeInTheDocument(),
    );
    expect(within(meter()).getByText('₹30,000')).toBeInTheDocument();
  }

  it.each([
    ['a negative rate', '-100'],
    ['a rate above the limit', '99999999'],
  ])('%s shows the field error at once and a neutral meter', async (_label, rate) => {
    const u = user();
    await atRate1500(u);
    await u.clear(rateField());
    await u.type(rateField(), rate);

    expect(screen.getByText('Must be between 0 and 10,00,000')).toBeInTheDocument();
    expect(rateField()).toHaveAttribute('aria-invalid', 'true');
    expect(within(meter()).getByText('Enter valid values to see the price check.')).toBeVisible();
    expect(within(meter()).queryByText('Confirmed by the server.')).not.toBeInTheDocument();
    expect(within(meter()).queryByText('₹30,000')).not.toBeInTheDocument();
  });

  it('clearing the rate prices the stay from the rate plan again', async () => {
    const u = user();
    await atRate1500(u);
    await u.clear(rateField());

    // No rate and no discount: the full price, 20 x 2000 = 40000.
    await waitFor(() =>
      expect(within(meter()).getByText('Confirmed by the server.')).toBeInTheDocument(),
    );
    expect(within(meter()).getAllByText('₹40,000').length).toBeGreaterThan(1);
  });

  it('an inclusion without a name or cost makes the meter neutral', async () => {
    const u = user();
    await atRate1500(u);
    await u.click(screen.getByRole('button', { name: 'Add inclusion' }));

    expect(within(meter()).getByText('Enter valid values to see the price check.')).toBeVisible();
    expect(within(meter()).queryByText('Confirmed by the server.')).not.toBeInTheDocument();
  });

  it('blurring an empty required field shows its error without pressing Next', async () => {
    const u = user();
    renderBuilder();
    await u.click(screen.getByLabelText(/Organiser name/));
    await u.tab();
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
  });
});

describe('quote builder: the live meter names the decision', () => {
  const meter = () => screen.getByRole('complementary', { name: 'Live price check' });

  it('says no rooms are available when another quote holds them all', async () => {
    // Another quote holds all 10 standard rooms on 1 and 2 Nov.
    const client = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => makeMockToken({ user_id: 'ravi', role: 'Sales' }),
    });
    await client.createQuote(
      {
        organiser: { name: 'Earlier Group' },
        stay: { check_in: '2026-11-01', nights: 2 },
        room_type: 'standard',
        rooms: 10,
        rate_per_room_night_inr: 2000,
      },
      { idempotencyKey: newIdempotencyKey() },
    );
    const u = user();
    renderBuilder();
    await fillGroup(u);
    await next(u);
    await u.clear(screen.getByLabelText(/^Rooms/));
    await u.type(screen.getByLabelText(/^Rooms/), '5');
    await next(u);
    await next(u);

    expect(await screen.findByText('This request cannot be offered')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(meter()).getByText('Cannot offer: no rooms available')).toBeInTheDocument(),
    );
    expect(within(meter()).queryByText(/Over the limit/)).not.toBeInTheDocument();
  });

  it('says the dates are not on sale when there is no inventory', async () => {
    const u = user();
    renderBuilder();
    await u.type(screen.getByLabelText(/Organiser name/), 'Winter Group');
    await u.type(screen.getByLabelText(/Check-in date/), '2026-12-20');
    await next(u);
    await next(u);
    await next(u);

    expect(await screen.findByText('This request cannot be offered')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(meter()).getByText('Cannot offer: not on sale on these dates'),
      ).toBeInTheDocument(),
    );
    expect(within(meter()).queryByText(/review required/)).not.toBeInTheDocument();
  });
});

describe('quote builder: check-in dates', () => {
  const meter = () => screen.getByRole('complementary', { name: 'Live price check' });

  it('refuses a check-in before today in the property time zone', async () => {
    const u = user();
    renderBuilder();
    await u.type(screen.getByLabelText(/Organiser name/), 'Fictional Events Pvt Ltd');
    await u.type(screen.getByLabelText(/Check-in date/), '2025-01-01');

    expect(screen.getByText('Check-in must be today (2026-10-20) or later')).toBeInTheDocument();
    expect(screen.getByLabelText(/Check-in date/)).toHaveAttribute('min', '2026-10-20');
    await next(u);
    expect(screen.getByRole('heading', { name: 'Group and dates' })).toBeInTheDocument();
    expect(within(meter()).queryByText('Unknown')).not.toBeInTheDocument();
    expect(within(meter()).queryByText('Confirmed by the server.')).not.toBeInTheDocument();
  });

  it('warns when the stay starts inside the stay cutoff plus the minimum validity', async () => {
    const u = user();
    renderBuilder();
    await u.type(screen.getByLabelText(/Organiser name/), 'Fictional Events Pvt Ltd');
    // Tomorrow: the 24 h cutoff is already past, so no quote could stay open for 2 h.
    await u.type(screen.getByLabelText(/Check-in date/), '2026-10-21');

    expect(await screen.findByText('Too late to quote for this date')).toBeInTheDocument();
    expect(screen.queryByText(/Check-in must be today/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(meter()).getByText('Cannot offer: too late to quote')).toBeInTheDocument(),
    );
  });
});

describe('quote builder: a discount in rupees, the contact and a note for the Owner', () => {
  async function toPricing(u: ReturnType<typeof user>) {
    await u.type(screen.getByLabelText(/Organiser name/), 'Fictional Events Pvt Ltd');
    await u.type(screen.getByLabelText(/Contact person/), 'Priya Rao');
    await u.type(screen.getByLabelText(/Email/), 'priya@fictional.example');
    await u.type(screen.getByLabelText(/Phone/), '+91 98765 43210');
    await u.type(screen.getByLabelText(/Check-in date/), '2026-11-01');
    await next(u);
    await next(u);
    await u.click(screen.getByRole('radio', { name: '₹ per room-night' }));
  }
  const discount = () => screen.getByLabelText('Discount off full price (₹ per room-night)');

  it('₹200 off the ₹2,000 full price is the 10% limit: a clean offer with the contact kept', async () => {
    const u = user();
    renderBuilder();
    await toPricing(u);
    await u.clear(discount());
    await u.type(discount(), '200');
    await next(u);

    expect(await screen.findByText('Ready to offer')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Note for the Owner' })).not.toBeInTheDocument();
    const issue = screen.getByRole('button', { name: 'Issue quote' });
    await waitFor(() => expect(issue).toBeEnabled());
    await u.click(issue);
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    const saved = [...store.quotes.values()][0];
    expect(saved?.request).toMatchObject({
      discount_inr: 200,
      organiser: {
        contact_name: 'Priya Rao',
        email: 'priya@fictional.example',
        phone: '+91 98765 43210',
      },
    });
    expect(screen.getByText('₹2,000 full price, ₹200 off = ₹1,800 per room-night')).toBeVisible();
    expect(screen.getByText(/Priya Rao · priya@fictional.example/)).toBeVisible();
  });

  it('₹201 off needs the Owner, and the note for the Owner is sent with it', async () => {
    const u = user();
    renderBuilder();
    await toPricing(u);
    await u.clear(discount());
    await u.type(discount(), '201');
    await next(u);

    expect(await screen.findByText('Owner review required')).toBeInTheDocument();
    await u.type(
      screen.getByLabelText(/Why these terms/),
      'Repeat client; they book every quarter.',
    );
    const send = screen.getByRole('button', { name: 'Send for Owner review' });
    await waitFor(() => expect(send).toBeEnabled());
    await u.click(send);
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    expect([...store.quotes.values()][0]?.request.note_for_owner).toBe(
      'Repeat client; they book every quarter.',
    );
    expect(screen.getByText('Repeat client; they book every quarter.')).toBeVisible();
  });
});

describe('quote builder: compare two options and issue the one chosen', () => {
  const compareTable = () => screen.getByRole('table', { name: 'The options side by side' });
  const column = (label: string) => {
    const cells = within(compareTable()).getAllByRole('row');
    const index = within(cells[0] as HTMLElement)
      .getAllByRole('columnheader')
      .findIndex((h) => h.textContent === label);
    return (row: string) => {
      const tr = cells.find((r) => within(r).queryByRole('rowheader', { name: row }));
      const td = within(tr as HTMLElement)
        .getAllByRole('cell')
        [index]?.cloneNode(true) as HTMLElement;
      // Badge icons are decoration, hidden from screen readers; read the cell as they do.
      td.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
      return td.textContent ?? '';
    };
  };

  /** Option A at full price, then Option B with 15% off, both compared on the last step. */
  async function compareFullPriceWith15Off(u: ReturnType<typeof user>) {
    await toReview(u, {});
    expect(await screen.findByText('Ready to offer')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Compare with another option' }));
    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeChecked();
    const discount = screen.getByLabelText('Discount off full price (%)');
    await u.clear(discount);
    await u.type(discount, '15');
    await next(u);
    await waitFor(() => expect(column('Option B')('Decision')).toBe('Owner review required'));
    await waitFor(() => expect(column('Option A')('Decision')).toBe('Ready to offer'));
  }

  it('shows both side by side, then issues only the option chosen', async () => {
    const u = user();
    const { container } = renderBuilder();
    await compareFullPriceWith15Off(u);
    expect(await axe(container)).toHaveNoViolations();

    expect(column('Option A')('Total for the client')).toBe('₹40,000');
    expect(column('Option B')('Total for the client')).toBe('₹34,000');
    expect(column('Option B')('Price')).toBe('₹2,000 full price, 15% off = ₹1,700 per room-night');
    expect(screen.queryByRole('button', { name: /Issue quote|Send for Owner review/ })).toBeNull();

    await u.click(screen.getByRole('button', { name: 'Choose Option B' }));
    expect(await screen.findByText('Owner review required')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'The options side by side' })).toBeNull();
    const send = screen.getByRole('button', { name: 'Send for Owner review' });
    await waitFor(() => expect(send).toBeEnabled());
    await u.click(send);
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    // Only the chosen option was issued, so no rooms were held twice.
    expect(store.quotes.size).toBe(1);
    expect([...store.quotes.values()][0]?.request.discount_pct).toBe(15);
  });

  it('choosing Option A issues it at full price', async () => {
    const u = user();
    renderBuilder();
    await compareFullPriceWith15Off(u);
    await u.click(screen.getByRole('button', { name: 'Choose Option A' }));
    const issue = await screen.findByRole('button', { name: 'Issue quote' });
    await waitFor(() => expect(issue).toBeEnabled());
    await u.click(issue);
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    expect(store.quotes.size).toBe(1);
    expect([...store.quotes.values()][0]?.request.discount_pct).toBe(0);
  });

  it('keeps both options in the draft when the person leaves', async () => {
    const u = user();
    const { router } = renderBuilder();
    await compareFullPriceWith15Off(u);
    await act(() => router.navigate('/'));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this quote?' });
    await u.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    await act(() => router.navigate('/quotes/new'));
    await u.click(await screen.findByRole('button', { name: 'Resume draft' }));
    await waitFor(() => expect(column('Option B')('Decision')).toBe('Owner review required'));
    expect(column('Option A')('Decision')).toBe('Ready to offer');
  });
});

describe('quote builder: the URL, drafts and leaving', () => {
  const stepHeading = (name: string) => screen.findByRole('heading', { name });

  it('puts the step in the URL, so browser Back and Forward move between steps', async () => {
    const u = user();
    const { router } = renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await next(u);
    expect(router.state.location.search).toBe('?step=2');
    await next(u);
    expect(router.state.location.search).toBe('?step=3');

    await act(() => router.navigate(-1));
    expect(await stepHeading('Rooms and type')).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await stepHeading('Group and dates')).toBeInTheDocument();
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Acme Offsite');
    await act(() => router.navigate(1));
    expect(await stepHeading('Rooms and type')).toBeInTheDocument();
  });

  it('never opens a later step than the form allows', async () => {
    renderBuilder('/quotes/new?step=4');
    expect(await stepHeading('Group and dates')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved input; staying keeps it', async () => {
    const u = user();
    const { router } = renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await act(() => router.navigate('/'));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this quote?' });
    await u.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(router.state.location.pathname).toBe('/quotes/new');
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Acme Offsite');
  });

  it('keeps a draft after leaving and offers to resume it or start over', async () => {
    const u = user();
    const { router } = renderBuilder();
    await fillGroup(u, 'Acme Offsite');
    await next(u);
    await act(() => router.navigate('/'));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this quote?' });
    await u.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    await act(() => router.navigate('/quotes/new'));
    expect(await screen.findByText(/You have a draft for Acme Offsite/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Resume draft' }));
    expect(await stepHeading('Rooms and type')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=2');
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Acme Offsite');
  });

  it('starting over clears the draft', async () => {
    sessionStorage.setItem(
      'c32.quote-draft',
      JSON.stringify({ step: 0, form: { ...initialForm, organiser: 'Old Group' } }),
    );
    const u = user();
    renderBuilder();
    await u.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('');
    expect(sessionStorage.getItem('c32.quote-draft')).toBeNull();
  });

  it('a resumed inclusion and a new one stay separate', async () => {
    // After a reload the id counter starts again, so a saved id can equal the next new one.
    const nextId = Number(newInclusion().id.slice('inc-'.length)) + 1;
    const breakfast = {
      id: `inc-${nextId}`,
      name: 'Breakfast',
      basis: 'per_guest_night' as const,
      unitCost: '150',
      costUnknown: false,
      includedInRate: true,
      price: '',
    };
    sessionStorage.setItem(
      'c32.quote-draft',
      JSON.stringify({
        step: 2,
        form: { ...initialForm, organiser: 'Old Group', inclusions: [breakfast] },
      }),
    );
    const u = user();
    renderBuilder();
    await u.click(await screen.findByRole('button', { name: 'Resume draft' }));
    // The draft was saved with check-in blank, so the wizard starts at the first open step.
    await u.type(await screen.findByLabelText(/Check-in date/), '2026-11-01');
    await next(u);
    await next(u);
    await u.click(screen.getByRole('button', { name: 'Add inclusion' }));
    await u.type(screen.getByLabelText(/Inclusion 2 name/), 'Dinner');
    expect(screen.getByLabelText(/Inclusion 1 name/)).toHaveValue('Breakfast');
  });

  it('warns the browser before a reload or closing the tab with unsaved input', async () => {
    const u = user();
    renderBuilder();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await fillGroup(u, 'Acme Offsite');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('issuing the quote leaves without asking and clears the draft', async () => {
    const u = user();
    const { router } = renderBuilder();
    await toReview(u, { rate: '2000' });
    const issue = await screen.findByRole('button', { name: 'Issue quote' });
    await waitFor(() => expect(issue).toBeEnabled());
    await u.click(issue);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/quotes\/[0-9A-Z]{26}$/));
    expect(screen.queryByRole('dialog', { name: 'Leave this quote?' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('c32.quote-draft')).toBeNull();
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
