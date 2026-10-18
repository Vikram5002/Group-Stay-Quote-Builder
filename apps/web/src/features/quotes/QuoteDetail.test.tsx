import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { DEFAULT_POLICY } from '@c32/core';
import type { Quote, QuoteRequest, Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { makeMockToken } from '../../mocks/auth';
import { createTestApi } from '../../mocks/server';
import { mockSession } from '../auth/auth';
import { maxExtensionHours } from './QuoteActions';

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
    getToken: () => makeMockToken({ user_id: creator, role: 'Reception' }),
  });
  return client.createQuote(request(overrides), { idempotencyKey: newIdempotencyKey() });
}

function renderDetail(id: string, role: Role = 'Reception', name = 'Ravi') {
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

    await u.click(await screen.findByRole('button', { name: 'Confirm booking…' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Confirm this booking?' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/10 Standard rooms, Sun 01 Nov 2026 to Tue 03 Nov 2026/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('₹40,000')).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(store.quotes.get(quote.quote_id)?.status).toBe('CONFIRMED'));
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Booking confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking…' })).not.toBeInTheDocument();
    expect(store.events.filter((e) => e.type === 'CONFIRMED')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Hold countdown' })).not.toBeInTheDocument();
  });

  it('extends validity and checks the hours', async () => {
    const quote = await seed();
    const before = quote.valid_until as string;
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Extend validity…' }));
    const hours = screen.getByLabelText('Extra hours');
    await u.click(screen.getByRole('radio', { name: '48 hours' }));
    expect(hours).toHaveValue(48);
    expect(screen.getByText(/; after this, until/)).toBeInTheDocument();
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
    expect(await screen.findByText(/Rooms are now held until/)).toBeInTheDocument();
  });

  it("limits extra hours to the policy's validity window for a Service Manager", async () => {
    store.policy = { ...store.policy, validity_hours: 24 };
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id, 'ServiceManager', 'Meera');

    await u.click(await screen.findByRole('button', { name: 'Extend validity…' }));
    const dialog = screen.getByRole('dialog');
    const hours = within(dialog).getByLabelText('Extra hours');
    await waitFor(() => expect(hours).toHaveAttribute('max', '24'));
    await u.clear(hours);
    await u.type(hours, '30');
    await u.click(within(dialog).getByRole('button', { name: 'Extend' }));

    expect(within(dialog).getByText('Must be between 1 and 24')).toBeInTheDocument();
    expect(store.quotes.get(quote.quote_id)?.version).toBe(1);
    store.policy = { ...store.policy, validity_hours: 72 };
  });

  it('never offers more hours than remain before the stay cutoff', async () => {
    const quote = await seed();
    // Check-in 1 Nov IST, cutoff 24 h before: 31 Oct 00:00 IST = 30 Oct 18:30 UTC.
    const near = { ...quote, valid_until: '2026-10-30T12:30:00.000Z' };
    expect(maxExtensionHours(near, { ...DEFAULT_POLICY, validity_hours: 72 })).toBe(6);
    expect(maxExtensionHours(quote, { ...DEFAULT_POLICY, validity_hours: 24 })).toBe(24);
    expect(maxExtensionHours(quote, undefined)).toBeNull();
  });

  it("shows the server's refusal inside the extend dialog, which stays open", async () => {
    store.policy = { ...store.policy, validity_hours: 24 };
    const quote = await seed();
    const u = userEvent.setup();
    // Reception cannot read the policy, so the server is the one that refuses.
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Extend validity…' }));
    const dialog = screen.getByRole('dialog');
    const hours = within(dialog).getByLabelText('Extra hours');
    await u.clear(hours);
    await u.type(hours, '30');
    await u.click(within(dialog).getByRole('button', { name: 'Extend' }));

    expect(
      await within(dialog).findByText('An extension can be at most 24 hours'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Extra hours')).toHaveValue(30);
    expect(screen.queryByText(/Reload the quote/)).not.toBeInTheDocument();
    store.policy = { ...store.policy, validity_hours: 72 };
  });

  it("shows a refused cancellation inside its dialog with the server's reason", async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Cancel quote…' }));
    // Someone else cancels it after this page loaded.
    store.quotes.set(quote.quote_id, { ...quote, status: 'CANCELLED' });
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Cancel quote' }));

    expect(await within(dialog).findByText('Cannot cancel a CANCELLED quote')).toBeInTheDocument();
  });

  it('cancels after a confirmation dialog and releases the rooms', async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Cancel quote…' }));
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

  it('is read-only for a Viewer, who can still download the quotation', async () => {
    const quote = await seed();
    renderDetail(quote.quote_id, 'Viewer', 'Vik');
    await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' });
    expect(screen.getByText(/can view this quote but not change it/)).toBeInTheDocument();
    for (const name of [
      'Confirm booking…',
      'Extend validity…',
      'Cancel quote…',
      'Change and re-quote',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Download quotation (PDF)' })).toBeInTheDocument();
  });

  it('shows that a Service Manager must approve a pending-review quote', async () => {
    const quote = await seed({ rate_per_room_night_inr: 1700 });
    renderDetail(quote.quote_id);
    expect(
      await screen.findByText(/A Service Manager who did not create this quote must approve it/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking…' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);
    // Said once, in the decision banner, not again above the actions.
    expect(screen.getAllByText('Service Manager review required')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Review this quote' })).not.toBeInTheDocument();
  });

  it('gives a Service Manager a link from a pending quote to the review queue', async () => {
    const quote = await seed({ rate_per_room_night_inr: 1700 });
    renderDetail(quote.quote_id, 'ServiceManager', 'Meera');
    expect(await screen.findByRole('link', { name: 'Review this quote' })).toHaveAttribute(
      'href',
      `/review?quote=${quote.quote_id}`,
    );
  });

  describe('review state follows the quote, not the original evaluation', () => {
    const ownerClient = createApiClient({
      baseUrl: BASE,
      getToken: () => makeMockToken({ user_id: 'meera', role: 'ServiceManager' }),
    });
    const approve = (id: string) =>
      ownerClient.approveQuote(
        id,
        { reason: 'Repeat client, strategic account' },
        { idempotencyKey: newIdempotencyKey() },
      );
    const header = async () =>
      (await screen.findByRole('heading', { level: 1, name: 'Fictional Events Pvt Ltd' }))
        .parentElement as HTMLElement;

    it('a pending below-floor quote needs review', async () => {
      const quote = await seed({ rate_per_room_night_inr: 1700 });
      renderDetail(quote.quote_id);
      expect(within(await header()).getByText('Needs review')).toBeInTheDocument();
      expect(screen.getByText('Service Manager review required')).toBeInTheDocument();
    });

    it('an approved quote shows who approved it, when and why', async () => {
      const quote = await seed({ rate_per_room_night_inr: 1700 });
      await approve(quote.quote_id);
      renderDetail(quote.quote_id);

      expect(within(await header()).getByText('Approved')).toBeInTheDocument();
      expect(within(await header()).queryByText('Needs review')).not.toBeInTheDocument();
      expect(screen.queryByText('Service Manager review required')).not.toBeInTheDocument();
      expect(screen.getByText('Approved below the floor')).toBeInTheDocument();
      expect(
        screen.getByText(/^Approved by meera on 20 Oct 2026.*: Repeat client, strategic account$/),
      ).toBeInTheDocument();
    });

    it('stays approved, not "needs review", once confirmed', async () => {
      const quote = await seed({ rate_per_room_night_inr: 1700 });
      await approve(quote.quote_id);
      const u = userEvent.setup();
      renderDetail(quote.quote_id);
      await u.click(await screen.findByRole('button', { name: 'Confirm booking…' }));
      await u.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm booking' }),
      );

      await waitFor(() => expect(store.quotes.get(quote.quote_id)?.status).toBe('CONFIRMED'));
      expect(within(await header()).queryByText('Needs review')).not.toBeInTheDocument();
      expect(screen.queryByText('Service Manager review required')).not.toBeInTheDocument();
      expect(screen.getByText(/^Approved by meera on/)).toBeInTheDocument();
    });

    it('a quote cancelled before any decision no longer asks for review', async () => {
      const quote = await seed({ rate_per_room_night_inr: 1700 });
      const client = createApiClient({
        baseUrl: BASE,
        getToken: () => makeMockToken({ user_id: 'asha', role: 'Reception' }),
      });
      await client.cancelQuote(quote.quote_id, {}, { idempotencyKey: newIdempotencyKey() });
      renderDetail(quote.quote_id);

      expect(within(await header()).queryByText('Needs review')).not.toBeInTheDocument();
      expect(screen.queryByText('Service Manager review required')).not.toBeInTheDocument();
      expect(screen.getByText('Closed before a Service Manager decided')).toBeInTheDocument();
    });
  });

  it('downloads the quotation as a PDF, and copies a summary to paste in a message', async () => {
    const quote = await seed();
    const saved: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:quotation';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Download quotation (PDF)' }));
    expect(saved[0]?.type).toBe('application/pdf');
    const bytes = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsBinaryString(saved[0] as Blob);
    });
    expect(bytes).toMatch(/^%PDF-1\.4/);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      'quotation-fictional-events-pvt-ltd-2026-11-01.pdf',
    );
    expect(screen.queryByRole('button', { name: 'Download JSON' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Copy summary' }));
    expect(await navigator.clipboard.readText()).toMatch(
      /^Quotation for Fictional Events Pvt Ltd \(ref \w{8}\)\nValid until /,
    );
    expect(await screen.findByText(/Quotation summary copied/)).toBeInTheDocument();

    // The short reference is shown; the full id can be copied for support.
    expect(screen.getByText(quote.quote_id.slice(-8))).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Copy id' }));
    expect(await navigator.clipboard.readText()).toBe(quote.quote_id);
    click.mockRestore();
  });

  it('says so when the quote does not exist', async () => {
    renderDetail('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quote not found' }),
    ).toBeInTheDocument();
  });

  it('re-quotes an expired quote with its details filled in', async () => {
    const quote = await seed({
      organiser: { name: 'Fictional Events Pvt Ltd', reference: 'FE-9' },
    });
    store.quotes.set(quote.quote_id, { ...quote, valid_until: '2020-01-01T00:00:00.000Z' });
    const u = userEvent.setup();
    renderDetail(quote.quote_id);
    expect(await screen.findByText('This quote expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking…' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Re-quote with these details' }));
    // Nothing is held any more, so there is nothing to cancel first.
    await screen.findByRole('heading', { level: 1, name: 'New quote' });
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Fictional Events Pvt Ltd');
    expect(screen.getByLabelText('Reference (optional)')).toHaveValue('FE-9');
    expect(screen.getByLabelText(/Check-in date/)).toHaveValue('2026-11-01');
    expect(
      screen.getByText(/Started from the quote for Fictional Events Pvt Ltd/),
    ).toBeInTheDocument();
    expect(store.quotes.get(quote.quote_id)?.status).toBe('EXPIRED');
  });

  it('re-quotes a pending quote at the suggested rate, cancelling it first', async () => {
    const quote = await seed({ rate_per_room_night_inr: 1700 });
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: /^Re-quote at ₹/ }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Replace this quote?' }),
    ).toBeInTheDocument();
    // Keeping it changes nothing.
    await u.click(within(dialog).getByRole('button', { name: 'Keep this quote' }));
    expect(store.quotes.get(quote.quote_id)?.status).toBe('PENDING_REVIEW');

    await u.click(screen.getByRole('button', { name: /^Re-quote at ₹/ }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel it and re-quote' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'New quote' });
    expect(store.quotes.get(quote.quote_id)?.status).toBe('CANCELLED');
    expect(screen.getByLabelText(/Organiser name/)).toHaveValue('Fictional Events Pvt Ltd');

    await u.click(screen.getByRole('button', { name: 'Next' }));
    await u.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Or a fixed rate per room-night (INR)')).toHaveValue(1800);
  });

  it('reduces the rooms in a confirmed booking', async () => {
    const quote = await seed();
    const client = createApiClient({
      baseUrl: BASE,
      getToken: () => makeMockToken({ user_id: 'asha', role: 'Reception' }),
    });
    await client.confirmQuote(quote.quote_id, { idempotencyKey: newIdempotencyKey() });
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Reduce rooms…' }));
    const dialog = screen.getByRole('dialog');
    const rooms = within(dialog).getByLabelText(/Rooms to keep/);
    expect(rooms).toHaveValue(9);
    await u.clear(rooms);
    await u.type(rooms, '10');
    await u.click(within(dialog).getByRole('button', { name: 'Reduce rooms' }));
    expect(within(dialog).getByText('Enter a number of rooms from 1 to 9')).toBeInTheDocument();

    await u.clear(rooms);
    await u.type(rooms, '8');
    await u.click(within(dialog).getByRole('button', { name: 'Reduce rooms' }));
    await waitFor(() => expect(store.quotes.get(quote.quote_id)?.request.rooms).toBe(8));
    expect(await screen.findByText('Booking reduced to 8 rooms.')).toBeInTheDocument();
    const night = store.inventory.find(
      (r) => r.date === '2026-11-01' && r.room_type === 'standard',
    );
    expect(night?.confirmed_units).toBe(8);
  });

  it('marks a hold that is about to end, and goes back to all quotes', async () => {
    const quote = await seed();
    store.quotes.set(quote.quote_id, { ...quote, valid_until: '2026-10-20T06:30:00.000Z' });
    renderDetail(quote.quote_id);
    expect(await screen.findByText('Less than an hour left on this hold.')).toBeInTheDocument();
    expect(screen.getByText('0h 30m left')).toHaveClass('text-danger');
    expect(screen.getByRole('link', { name: /All quotes/ })).toHaveAttribute('href', '/quotes');
  });

  it("shows the server's refusal and refreshes the quote", async () => {
    const quote = await seed();
    const u = userEvent.setup();
    renderDetail(quote.quote_id);
    await u.click(await screen.findByRole('button', { name: 'Confirm booking…' }));

    // The hold lapses after the page loaded.
    store.quotes.set(quote.quote_id, { ...quote, valid_until: '2020-01-01T00:00:00.000Z' });
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm booking' }),
    );

    expect(await screen.findByText('Could not confirm the booking')).toBeInTheDocument();
    expect(screen.getByText(/Quote expired at 2020-01-01/)).toBeInTheDocument();
    expect(await screen.findByText('This quote expired')).toBeInTheDocument();
    // The refusal offers the way forward: a new quote with the same details.
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Re-quote with these details',
      }),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const quote = await seed();
    const { container } = renderDetail(quote.quote_id);
    await screen.findByRole('heading', { name: 'Audit timeline' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('quote and invoice emails (D-059)', () => {
  it('emails the quote, then after payment the invoice', async () => {
    const quote = await seed({ organiser: { name: 'Wedding party', email: 'events@example.com' } });
    const u = userEvent.setup();
    renderDetail(quote.quote_id);

    await u.click(await screen.findByRole('button', { name: 'Email quote' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Send to')).toHaveValue('events@example.com');
    await u.click(within(dialog).getByRole('button', { name: 'Send PDF' }));
    expect(await screen.findByText(/Quote emailed to events@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email invoice' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Confirm booking…' }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm booking' }),
    );
    expect(
      await screen.findByText('The invoice can be emailed once the payment is recorded.'),
    ).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Record payment' }));
    await u.type(screen.getByLabelText(/Payment reference/), 'UPI 4321');
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record payment' }),
    );
    expect(await screen.findByText(/Payment recorded .* \(UPI 4321\)/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Email invoice' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send PDF' }));
    expect(await screen.findByText(/Invoice emailed to events@example.com/)).toBeInTheDocument();
  });
});
