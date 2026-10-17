import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
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
      <RouterProvider router={createTestRouter(['/evidence'])} />
    </Providers>,
  );
}

describe('evidence page', () => {
  it('is honest that the data is synthetic', () => {
    renderPage();
    expect(screen.getByText('All data is synthetic')).toBeInTheDocument();
    expect(screen.getByText(/process evidence only/)).toBeInTheDocument();
  });

  it('shows the three stages with their tags and says when files are still awaited', () => {
    renderPage();
    const stages = screen
      .getByRole('heading', { name: 'Three stages' })
      .closest('section') as HTMLElement;
    for (const tag of ['baseline-v0', 'scope-negotiated', 'final-v1']) {
      expect(within(stages).getByText(tag)).toBeInTheDocument();
    }
    expect(within(stages).getAllByText('Awaiting files from Track 4')).toHaveLength(3);
  });

  it('shows what changed between baseline, scope and final', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'What each stage covers' });
    const availability = within(table).getByRole('row', { name: /Room-night availability/ });
    const cells = within(availability)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells.map((c) => c?.replace(/^[•i✓]/, ''))).toEqual(['No', 'Agreed to add', 'Yes']);
    const revenue = within(table).getByRole('row', { name: /Revenue and contribution/ });
    expect(within(revenue).getAllByText('Yes')).toHaveLength(3);
  });

  it('lists the ledger, filters it by type and recomputes the derived claims', async () => {
    const u = userEvent.setup();
    renderPage();
    const ledger = screen.getByRole('table', { name: 'Evidence ledger' });
    expect(within(ledger).getAllByRole('row')).toHaveLength(8);
    expect(screen.getByText('Derived: 2')).toBeInTheDocument();
    expect(screen.getByText('Assumption: 3')).toBeInTheDocument();
    expect(
      within(ledger).getByText(/Recomputed now: Revenue 40000, contribution 24000\./),
    ).toBeInTheDocument();
    expect(
      within(ledger).getByText(/Recomputed now: Minimum safe rate 2000\./),
    ).toBeInTheDocument();
    expect(within(ledger).getAllByText(/Matches the claim\./)).toHaveLength(2);

    await u.selectOptions(screen.getByLabelText('Show'), 'Assumption');
    const rows = within(screen.getByRole('table', { name: 'Evidence ledger' })).getAllByRole('row');
    expect(rows.map((r) => within(r).queryByText(/^E0\d$/)?.textContent).filter(Boolean)).toEqual([
      'E03',
      'E04',
      'E05',
    ]);
  });

  it('runs the three public checks against the API and reports each result', async () => {
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByRole('button', { name: 'Run the public checks' }));

    expect(await screen.findByText('3 of 3 checks passed')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Public check results' });
    expect(within(table).getAllByText('Pass')).toHaveLength(3);
    expect(
      within(table).getAllByText(/Revenue 40000, contribution 24000, auto-confirm allowed/),
    ).toHaveLength(2);
    expect(within(table).getByText(/PARTIAL_OFFER, 10 rooms offered/)).toBeInTheDocument();
    expect(within(table).getByText(/REVIEW, reasons FLOOR_BREACH/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download the result (JSON)' })).toBeInTheDocument();
    // They are previews: nothing was held or saved.
    expect(store.quotes.size).toBe(0);
    const night = store.inventory.find(
      (r) => r.date === '2026-11-01' && r.room_type === 'standard',
    );
    expect(night?.available_units).toBe(10);
  });

  it('shows a failing check as a failure', async () => {
    store.ratePlan.forEach((r) => {
      if (r.room_type === 'standard') r.rate_per_room_night_inr = 2000;
    });
    // The API disagrees with the fixture: only 8 rooms are on sale.
    store.inventory.forEach((r) => {
      if (r.room_type === 'standard' && r.total_units !== null) {
        r.total_units = 8;
        r.available_units = 8;
      }
    });
    const u = userEvent.setup();
    renderPage();
    await u.click(screen.getByRole('button', { name: 'Run the public checks' }));
    expect(await screen.findByText('2 of 3 checks passed')).toBeInTheDocument();
    expect(screen.getAllByText('Fail')).toHaveLength(1);
  });

  it('does not let a Viewer run the checks', () => {
    renderPage('Viewer');
    expect(screen.getByRole('button', { name: 'Run the public checks' })).toBeDisabled();
    expect(screen.getByText(/cannot create previews/)).toBeInTheDocument();
  });

  it('gives a download link for the evidence bundle', async () => {
    const u = userEvent.setup();
    renderPage('Viewer');
    await u.click(screen.getByRole('button', { name: 'Get the bundle download link' }));
    expect(
      await screen.findByRole('link', { name: 'Download the evidence bundle (zip)' }),
    ).toHaveAttribute('href', 'https://downloads.c32.example/exports/evidence.zip');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
