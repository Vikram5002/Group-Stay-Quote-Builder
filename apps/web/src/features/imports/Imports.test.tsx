import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { RouterProvider } from 'react-router-dom';
import type { Role } from '@c32/core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '../../app/Providers';
import { createTestRouter } from '../../app/router';
import { createApiClient, newIdempotencyKey } from '../../lib/api';
import { makeMockToken } from '../../mocks/auth';
import { UPLOAD_ORIGIN } from '../../mocks/handlers';
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
  store.uploads.clear();
  store.loaded = {};
  store.idempotency.clear();
  store.inventory.length = 0;
  store.ratePlan.length = 0;
});

function renderPage(role: Role = 'Owner') {
  return render(
    <Providers initialSession={mockSession(role, 'Meera')} baseUrl={BASE}>
      <RouterProvider router={createTestRouter(['/imports'])} />
    </Providers>,
  );
}

const csv = (text: string, name = 'inventory.csv') => new File([text], name, { type: 'text/csv' });
const fileInput = () => screen.getByLabelText(/File \(CSV or JSON\)/);

const GOOD = 'date,room_type,rooms\n2026-11-01,standard,10\n2026-11-02,standard,\n';

async function pick(u: ReturnType<typeof userEvent.setup>, file: File) {
  await u.upload(fileInput(), file);
}

describe('importing a file', () => {
  it('previews the file with empty cells shown as Unknown, not zero', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv(GOOD));

    const preview = await screen.findByRole('table', { name: /First rows of the file/ });
    expect(screen.getByText('2 rows read from the file')).toBeInTheDocument();
    const rows = within(preview).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('10')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Unknown')).toBeInTheDocument();
  });

  it('checks the file without importing, then imports after confirmation', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv(GOOD));
    await u.click(screen.getByRole('button', { name: 'Check file' }));

    expect(await screen.findByText('The file passed the check')).toBeInTheDocument();
    expect(
      screen.getByText(/2 rows read: 2 accepted, 0 rejected\. 0 errors, 1 warning/),
    ).toBeInTheDocument();
    const problems = screen.getByRole('table', { name: 'Problems found, by row' });
    expect(within(problems).getByText(/availability is unknown/)).toBeInTheDocument();
    expect(within(problems).getByText('Warning')).toBeInTheDocument();
    expect(store.inventory).toHaveLength(0);

    await u.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    expect(store.inventory.map((r) => [r.date, r.total_units, r.available_units])).toEqual([
      ['2026-11-01', 10, 10],
      ['2026-11-02', null, null],
    ]);
  });

  it('treats a file identical to the loaded one as no change', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv(GOOD));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await u.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    await screen.findByText('Imported');

    await pick(u, csv(GOOD));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await u.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    expect(
      await screen.findByText('Nothing changed: this file matches what is already loaded'),
    ).toBeInTheDocument();
  });

  it('lists every problem by row number and offers no import', async () => {
    const u = userEvent.setup();
    renderPage();
    const bad = [
      'date,room_type,rooms',
      '2026-11-01,standard,10',
      '2026-11-02,standard,ten',
      '2026-13-45,standard,5',
      '2026-11-01,standard,8',
    ].join('\n');
    await pick(u, csv(bad));
    await u.click(screen.getByRole('button', { name: 'Check file' }));

    expect(
      await screen.findByText('The file has problems, so nothing can be imported'),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Problems found, by row' });
    const rows = within(table).getAllByRole('row').slice(1);
    const rowNumbers = rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    expect(rowNumbers).toEqual(['2', '3', '4']);
    expect(within(rows[2] as HTMLElement).getByText(/Duplicate of row 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import \d+ row/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Fix the rows listed above/)).toBeInTheDocument();
    expect(store.inventory).toHaveLength(0);
  });

  it('refuses a file whose header is wrong before anything is uploaded', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv('date,room_type\n2026-11-01,standard'));
    expect(await screen.findByText('This file cannot be read')).toBeInTheDocument();
    expect(screen.getByText(/header row is missing: rooms/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('only accepts CSV or JSON files', async () => {
    const u = userEvent.setup({ applyAccept: false });
    renderPage();
    await pick(u, new File(['x'], 'rooms.xlsx'));
    expect(await screen.findByText('Use a .csv or .json file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('imports rates and keeps empty costs unknown', async () => {
    const u = userEvent.setup();
    renderPage();
    await u.selectOptions(screen.getByLabelText('What are you importing?'), 'rates');
    const rates = [
      'date,room_type,rate_per_room_night_inr,variable_cost_per_room_night_inr,rack_rate_inr',
      '2026-11-01,standard,2000,800,',
      '2026-11-02,standard,2000,,',
    ].join('\n');
    await pick(u, csv(rates, 'rates.csv'));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('The file passed the check')).toBeInTheDocument();
    expect(screen.getByText(/quotes that need it go to review/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    await screen.findByText('Imported');
    expect(store.ratePlan.map((r) => r.variable_cost_per_room_night_inr)).toEqual([800, null]);
  });

  it('reads a JSON file too', async () => {
    const u = userEvent.setup();
    renderPage();
    const json = JSON.stringify([{ date: '2026-11-01', room_type: 'standard', rooms: 6 }]);
    await pick(u, new File([json], 'inventory.json', { type: 'application/json' }));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await u.click(await screen.findByRole('button', { name: 'Import 1 row' }));
    await screen.findByText('Imported');
    expect(store.inventory[0]?.total_units).toBe(6);
  });

  it('explains an upload that fails', async () => {
    server.use(
      http.put(`${UPLOAD_ORIGIN}/imports/:id`, () => new HttpResponse(null, { status: 403 })),
    );
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv(GOOD));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('That did not work')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.queryByText('The file passed the check')).not.toBeInTheDocument();
  });

  it('offers a template with the right columns', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Download a template' });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain('date,room_type,rooms');
    expect(link).toHaveAttribute('download', 'inventory-template.csv');
  });
});

describe('who can import', () => {
  it('shows Sales and Viewers the exports only', () => {
    renderPage('Sales');
    expect(screen.getByText('Imports are for Owners')).toBeInTheDocument();
    expect(screen.queryByLabelText(/File \(CSV or JSON\)/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Export' })).toBeInTheDocument();
  });
});

describe('exports', () => {
  it('gives a download link for quotes that works, with unknown values left empty', async () => {
    const sales = createApiClient({
      baseUrl: BASE,
      getToken: () => makeMockToken({ user_id: 'asha', role: 'Sales' }),
    });
    store.inventory.push(
      {
        date: '2026-11-01',
        room_type: 'deluxe',
        total_units: 4,
        available_units: 4,
        held_units: 0,
        confirmed_units: 0,
      },
      {
        date: '2026-11-02',
        room_type: 'deluxe',
        total_units: 4,
        available_units: 4,
        held_units: 0,
        confirmed_units: 0,
      },
    );
    store.ratePlan.push(
      {
        date: '2026-11-01',
        room_type: 'deluxe',
        rate_per_room_night_inr: 3500,
        variable_cost_per_room_night_inr: null,
        rack_rate_inr: null,
      },
      {
        date: '2026-11-02',
        room_type: 'deluxe',
        rate_per_room_night_inr: 3500,
        variable_cost_per_room_night_inr: null,
        rack_rate_inr: null,
      },
    );
    await sales.createQuote(
      {
        organiser: { name: 'Unknown Cost Group' },
        stay: { check_in: '2026-11-01', nights: 2 },
        room_type: 'deluxe',
        rooms: 2,
      },
      { idempotencyKey: newIdempotencyKey() },
    );

    const u = userEvent.setup();
    renderPage('Viewer');
    await u.click(screen.getByRole('button', { name: 'Get quotes download link' }));
    const link = await screen.findByRole('link', { name: 'Download quotes (csv)' });
    expect(link).toHaveAttribute('href', 'https://downloads.c32.example/exports/quotes.csv');
    expect(screen.getByText(/Link works until/)).toBeInTheDocument();

    const body = await (await fetch(link.getAttribute('href') as string)).text();
    const [header, line] = body.trim().split('\r\n');
    expect(header).toContain('contribution_inr');
    expect(line).toContain('Unknown Cost Group');
    // The unknown contribution is an empty cell between rooms_offered and valid_until.
    expect(line).toMatch(/,2,,2026-/);
  });

  it('exports JSON and the evidence bundle', async () => {
    const u = userEvent.setup();
    renderPage('Sales');
    await u.selectOptions(screen.getByLabelText('Format'), 'json');
    await u.click(screen.getByRole('button', { name: 'Get quotes download link' }));
    expect(await screen.findByRole('link', { name: 'Download quotes (json)' })).toHaveAttribute(
      'href',
      'https://downloads.c32.example/exports/quotes.json',
    );
    await u.click(screen.getByRole('button', { name: 'Get evidence download link' }));
    expect(
      await screen.findByRole('link', { name: 'Download evidence bundle (zip)' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('That did not work')).not.toBeInTheDocument());
  });
});

describe('accessibility (axe)', () => {
  it('has no violations with a report on screen', async () => {
    const u = userEvent.setup();
    const { container } = renderPage();
    await pick(u, csv('date,room_type,rooms\n2026-11-01,standard,x\n'));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await screen.findByRole('table', { name: 'Problems found, by row' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('file size', () => {
  it('refuses a file over 2 MB before uploading anything', async () => {
    const u = userEvent.setup();
    renderPage();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'inventory.csv', {
      type: 'text/csv',
    });
    await u.upload(screen.getByLabelText(/File \(CSV or JSON\)/), big);
    expect(await screen.findByText(/over 2 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
    expect(store.uploads.size).toBe(0);
  });
});
