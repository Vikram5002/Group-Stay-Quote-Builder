import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { DEFAULT_POLICY, problem } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createApiClient } from '../../lib/api';
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
beforeEach(() => {
  store.policy = { ...DEFAULT_POLICY, version: 1 };
});

function renderPage(role: Role = 'ServiceManager') {
  const router = createTestRouter(['/policy']);
  const view = render(
    <Providers initialSession={mockSession(role, 'Meera')} baseUrl={BASE}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router };
}

const field = async (label: RegExp | string) => screen.findByLabelText(label);
const save = () => screen.getByRole('button', { name: 'Save policy' });

async function setValue(
  u: ReturnType<typeof userEvent.setup>,
  label: RegExp | string,
  value: string,
) {
  const input = await field(label);
  await u.clear(input);
  if (value) await u.type(input, value);
}

describe('policy screen', () => {
  it('is for Service Managers only', () => {
    renderPage('Reception');
    expect(screen.getByRole('heading', { level: 1, name: 'Not allowed' })).toBeInTheDocument();
  });

  it('shows the current policy and its version', async () => {
    renderPage();
    expect(await field(/Package floor \(INR\)/)).toHaveValue(20000);
    expect(screen.getByLabelText(/Quote validity/)).toHaveValue(72);
    expect(screen.getByLabelText(/Default guests per room/)).toHaveValue(2);
    expect(screen.getByText(/Version 1\./)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('says what a change does before it is saved', async () => {
    const u = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/How long rooms stay held .* Now 3 days\./)).toBeInTheDocument();
    await setValue(u, /Max Reception discount/, '15');
    const before = screen
      .getByRole('heading', { name: 'Before you save' })
      .closest('section') as HTMLElement;
    expect(within(before).getByText('Max Reception discount: 10 to 15')).toBeInTheDocument();
    expect(
      within(before).getByText('Lowest price Reception can give alone: ₹1,800 to ₹1,700'),
    ).toBeInTheDocument();
    await setValue(u, /Quote validity/, '30');
    expect(screen.getByText(/How long rooms stay held .* Now 1 day 6 hours\./)).toBeInTheDocument();
  });

  it('shows the time in the chosen zone, to check it', async () => {
    const u = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/It is now .* there\./)).toBeInTheDocument();
    await setValue(u, /Time zone/, 'Mars/Olympus');
    expect(screen.getByText('A time zone name such as Asia/Kolkata.')).toBeInTheDocument();
  });

  it('saves a change, bumps the version and lists what changed', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '48');
    expect(save()).toBeEnabled();
    await u.click(save());

    expect(await screen.findByText('Policy saved as version 2.')).toBeInTheDocument();
    expect(store.policy.validity_hours).toBe(48);
    expect(store.policy.version).toBe(2);
    expect(screen.getByText('Validity: 72 to 48')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('applies the saved policy to new quotes', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '48');
    await u.click(save());
    await screen.findByText('Policy saved as version 2.');

    const sales = createApiClient({
      baseUrl: BASE,
      getToken: () => makeMockToken({ user_id: 'asha', role: 'Reception' }),
    });
    const { valid_until } = await sales.previewQuote({
      organiser: { name: 'Fictional Events Pvt Ltd' },
      stay: { check_in: '2026-11-01', nights: 2 },
      room_type: 'standard',
      rooms: 10,
      rate_per_room_night_inr: 2000,
    });
    expect(Date.parse(valid_until as string) - Date.now()).toBe(48 * 3_600_000);
  });

  it('keeps an unknown value unknown instead of making it a number', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Default guests per room/, '');
    await u.click(save());
    await screen.findByText('Policy saved as version 2.');
    expect(store.policy.guests_per_room_units).toBeNull();
    expect(screen.getByText('Guests per room: 2 to Unknown')).toBeInTheDocument();
  });

  it('checks values with the same rules as the server', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '0');
    await u.click(save());
    expect(screen.getByText('Must be between 1 and 720')).toBeInTheDocument();
    expect(screen.getByLabelText(/Quote validity/)).toHaveAttribute('aria-invalid', 'true');
    expect(store.policy.version).toBe(1);

    await setValue(u, /Quote validity/, '72');
    await setValue(u, /Total rooms/, '0');
    await u.click(save());
    expect(screen.getByText('Must be between 1 and 500')).toBeInTheDocument();

    await setValue(u, /Total rooms/, '10');
    await setValue(u, /Minimum validity/, '100');
    await u.click(save());
    expect(screen.getByText(/cannot exceed validity_hours/)).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const u = userEvent.setup();
    const { router } = renderPage();
    await setValue(u, /Quote validity/, '10');

    await act(() => router.navigate('/'));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await u.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(router.state.location.pathname).toBe('/policy');
    expect(screen.getByLabelText(/Quote validity/)).toHaveValue(10);

    await act(() => router.navigate('/'));
    await u.click(
      within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole(
        'button',
        { name: 'Leave' },
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('leaves without asking once the changes are saved', async () => {
    const u = userEvent.setup();
    const { router } = renderPage();
    await setValue(u, /Quote validity/, '10');
    await u.click(save());
    await screen.findByText('Policy saved as version 2.');
    await act(() => router.navigate('/'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument();
  });

  it('discards edits', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '10');
    await u.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText(/Quote validity/)).toHaveValue(72);
  });

  it('refuses to overwrite a newer version and offers the latest', async () => {
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '10');

    // Someone else saves first.
    store.policy = { ...store.policy, validity_hours: 96, version: 2 };
    await u.click(save());

    expect(await screen.findByText('The policy was changed by someone else')).toBeInTheDocument();
    expect(store.policy.validity_hours).toBe(96);
    await u.click(screen.getByRole('button', { name: 'Load the latest version' }));
    expect(await screen.findByText(/Version 2\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quote validity/)).toHaveValue(96);
    expect(screen.queryByText('The policy was changed by someone else')).not.toBeInTheDocument();
  });

  it("explains a refused save in the server's own words", async () => {
    server.use(
      http.put('*/v1/policy', () =>
        HttpResponse.json(
          problem('INVALID_STATE', { detail: 'Policy changes are paused during the audit' }),
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const u = userEvent.setup();
    renderPage();
    await setValue(u, /Quote validity/, '10');
    await u.click(save());

    expect(await screen.findByText('Could not save the policy')).toBeInTheDocument();
    expect(screen.getByText('Policy changes are paused during the audit')).toBeInTheDocument();
  });

  it('is honest that change history lasts only for the visit', async () => {
    renderPage();
    expect(await screen.findByText(/Changes you save are listed here/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await field(/Quote validity/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
