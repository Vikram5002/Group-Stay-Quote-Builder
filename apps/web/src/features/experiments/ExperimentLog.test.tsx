import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { readFileText } from '../../lib/imports';
import { makeMockToken } from '../../mocks/auth';
import { createTestApi } from '../../mocks/server';
import { mockSession } from '../auth/auth';
import { EXPERIMENT_STORAGE_KEY } from './store';

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
  localStorage.clear();
  store.quotes.clear();
  store.idempotency.clear();
  for (const row of store.inventory) {
    if (row.total_units !== null) {
      row.available_units = row.total_units;
      row.held_units = 0;
      row.confirmed_units = 0;
    }
  }
});

function renderPage(role: Role = 'Sales') {
  return render(
    <Providers initialSession={mockSession(role, 'Ravi')} baseUrl={BASE}>
      <RouterProvider router={createTestRouter(['/experiments'])} />
    </Providers>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function fill(
  u: User,
  values: { role?: string; sent?: string; responded?: string; tier?: string; said?: string },
) {
  if (values.role) await u.type(screen.getByLabelText(/Role played/), values.role);
  if (values.sent) await u.type(screen.getByLabelText(/Sent at/), values.sent);
  if (values.responded) await u.type(screen.getByLabelText(/First response at/), values.responded);
  if (values.tier) await u.selectOptions(screen.getByLabelText('How far it went'), values.tier);
  if (values.said) await u.type(screen.getByLabelText(/What they said/), values.said);
}

const consent = (u: User) => u.click(screen.getByLabelText('This person agreed to play the role'));
const add = (u: User) => u.click(screen.getByRole('button', { name: 'Add to the log' }));
const contacts = () => screen.getByRole('table', { name: 'Experiment contacts' });

describe('experiment log', () => {
  it('is honest about what the evidence is and where it is kept', () => {
    renderPage();
    expect(
      screen.getByText('Role-play is process evidence, not market demand'),
    ).toBeInTheDocument();
    expect(screen.getByText('Kept in this browser only')).toBeInTheDocument();
    expect(screen.getByText('No contacts logged yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('explains what is missing instead of saving an incomplete contact', async () => {
    const u = userEvent.setup();
    renderPage();
    await add(u);
    expect(screen.getByText(/Say which role was played/)).toBeInTheDocument();
    expect(screen.getByText('Enter when the quote was sent.')).toBeInTheDocument();
    expect(
      screen.getByText('Confirm that the person agreed to play this role.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Role played/)).toHaveAttribute('aria-invalid', 'true');
    expect(localStorage.getItem(EXPERIMENT_STORAGE_KEY)).toBeNull();
  });

  it('logs a contact that responded, with the time to respond and the tier', async () => {
    const u = userEvent.setup();
    renderPage();
    await fill(u, {
      role: 'Corporate offsite planner',
      sent: '2026-10-20T09:30',
      responded: '2026-10-20T11:45',
      tier: '2',
      said: 'Asked to include breakfast',
    });
    await consent(u);
    await add(u);

    expect(await screen.findByText('ORG-01 was added to the log.')).toBeInTheDocument();
    const row = within(contacts()).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Corporate offsite planner')).toBeInTheDocument();
    expect(within(row).getByText(/20 Oct 2026, 09:30 IST/)).toBeInTheDocument();
    expect(within(row).getByText('after 2h 15m')).toBeInTheDocument();
    expect(within(row).getByText('2: Asked for a change')).toBeInTheDocument();
    expect(within(row).getByText('Asked to include breakfast')).toBeInTheDocument();
    expect(
      screen.getByText('1 contact logged, 1 responded, 0 with no response yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Tier 2, Asked for a change: 1')).toBeInTheDocument();
  });

  it('records no reply as no reply, never as zero', async () => {
    const u = userEvent.setup();
    renderPage();
    await fill(u, { role: 'Wedding planner', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);

    const row = within(contacts()).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('No response yet')).toBeInTheDocument();
    expect(within(row).getByText('None')).toBeInTheDocument();
    expect(within(row).getByText('Nothing recorded')).toBeInTheDocument();
    expect(
      screen.getByText('1 contact logged, 0 responded, 1 with no response yet.'),
    ).toBeInTheDocument();
  });

  it('keeps a tier tied to a response and a response after the send time', async () => {
    const u = userEvent.setup();
    renderPage();
    await fill(u, { role: 'Planner', sent: '2026-10-20T10:00', tier: '3' });
    await consent(u);
    await add(u);
    expect(screen.getByText(/A tier needs a response time/)).toBeInTheDocument();

    await u.selectOptions(screen.getByLabelText('How far it went'), '');
    await u.type(screen.getByLabelText(/First response at/), '2026-10-20T09:00');
    await u.selectOptions(screen.getByLabelText('How far it went'), '1');
    await add(u);
    expect(
      screen.getByText('The response cannot be before the quote was sent.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Planner/ })).not.toBeInTheDocument();
  });

  it('numbers contacts in order and keeps them after a reload', async () => {
    const u = userEvent.setup();
    const first = renderPage();
    await fill(u, { role: 'Planner A', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);
    await fill(u, { role: 'Planner B', sent: '2026-10-20T10:30' });
    await consent(u);
    await add(u);
    expect(within(contacts()).getByText('ORG-02')).toBeInTheDocument();
    first.unmount();

    renderPage();
    expect(within(contacts()).getByText('ORG-01')).toBeInTheDocument();
    expect(within(contacts()).getByText('Planner B')).toBeInTheDocument();
  });

  it('attaches a saved quote and its version', async () => {
    const sales = createApiClient({
      baseUrl: BASE,
      getToken: () => makeMockToken({ user_id: 'asha', role: 'Sales' }),
    });
    const quote = await sales.createQuote(
      {
        organiser: { name: 'Fictional Events Pvt Ltd' },
        stay: { check_in: '2026-11-01', nights: 2 },
        room_type: 'standard',
        rooms: 10,
        rate_per_room_night_inr: 2000,
      },
      { idempotencyKey: newIdempotencyKey() },
    );
    const u = userEvent.setup();
    renderPage();
    await screen.findByRole('option', { name: /Fictional Events Pvt Ltd/ });
    await u.selectOptions(screen.getByLabelText(/Quote from this tool/), quote.quote_id);
    await fill(u, { role: 'Planner', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);
    const row = within(contacts()).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText(`${quote.quote_id.slice(-8)} v1`)).toBeInTheDocument();
  });

  it('does not attach a tool quote to a spreadsheet-style contrast quote', async () => {
    const u = userEvent.setup();
    renderPage();
    await u.selectOptions(screen.getByLabelText('Quote sent'), 'spreadsheet');
    expect(screen.getByLabelText(/Quote from this tool/)).toBeDisabled();
    await fill(u, { role: 'Contrast planner', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);
    expect(
      within(contacts()).getByText('Spreadsheet-style quote (for contrast)'),
    ).toBeInTheDocument();
  });

  it('removes a contact only after confirmation', async () => {
    const u = userEvent.setup();
    renderPage();
    await fill(u, { role: 'Planner', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);

    await u.click(screen.getByRole('button', { name: 'Remove ORG-01' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }));
    expect(within(contacts()).getByText('ORG-01')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Remove ORG-01' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No contacts logged yet')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(EXPERIMENT_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('exports the log as CSV', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      created.push(blob as Blob);
      return 'blob:log';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const u = userEvent.setup();
    renderPage();
    await fill(u, {
      role: 'Planner',
      sent: '2026-10-20T10:00',
      responded: '2026-10-20T12:00',
      tier: '1',
    });
    await consent(u);
    await add(u);
    await u.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(click).toHaveBeenCalled();
    const text = await readFileText(created[0] as Blob);
    expect(text).toContain('contact_id,role_played,channel');
    expect(text).toContain('ORG-01,Planner,Email');
    expect(text).toContain(',120,');
    click.mockRestore();
  });

  it('has no accessibility violations', async () => {
    const u = userEvent.setup();
    const { container } = renderPage();
    await fill(u, { role: 'Planner', sent: '2026-10-20T10:00' });
    await consent(u);
    await add(u);
    expect(await axe(container)).toHaveNoViolations();
  });
});
