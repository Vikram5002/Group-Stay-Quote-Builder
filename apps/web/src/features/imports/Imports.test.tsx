import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { RouterProvider } from 'react-router-dom';
import { problem } from '@c32/core';
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
    expect(
      within(problems).getByText('Empty: imported as unknown (null), not 0'),
    ).toBeInTheDocument();
    expect(within(problems).getByText('(empty)')).toBeInTheDocument();
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

  it('lists every problem by row number and imports only the good rows, like the real service', async () => {
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
      await screen.findByText('Some rows have errors and will be skipped'),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 row accepted|1 accepted/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Problems found, by row' });
    const rows = within(table).getAllByRole('row').slice(1);
    const rowNumbers = rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    expect(rowNumbers).toEqual(['2', '3', '4']);
    expect(
      within(rows[2] as HTMLElement).getByText('standard on 2026-11-01 already appears on row 1'),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('Rooms must be a whole number'),
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('ten')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('Date must be YYYY-MM-DD and a real calendar date'),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 rows have errors and will not be imported/)).toBeInTheDocument();
    expect(store.inventory).toHaveLength(0);

    await u.click(screen.getByRole('button', { name: 'Import 1 row' }));
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    expect(store.inventory.map((r) => [r.date, r.total_units])).toEqual([['2026-11-01', 10]]);
  });

  it('can show only the errors when there are warnings too', async () => {
    const u = userEvent.setup();
    renderPage();
    const lines = ['date,room_type,rooms', '2026-11-01,standard,', '2026-11-02,standard,ten'];
    await pick(u, csv(`${lines.join('\n')}\n`));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    const table = await screen.findByRole('table', { name: 'Problems found, by row' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await u.click(screen.getByLabelText('Show errors only (1 error)'));
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText('Error')).toBeInTheDocument();
  });

  it('takes a dropped file, and offers the next steps after importing', async () => {
    const u = userEvent.setup();
    renderPage();
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [csv(GOOD)] } });
    expect(await screen.findByText('Chosen: inventory.csv')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await u.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See the rooms on the availability calendar' }),
    ).toHaveAttribute('href', '/availability');

    await u.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.queryByText('Imported')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Chosen:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('rejects a room type the property does not sell, and shows the bad value', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv('date,room_type,rooms\n2026-11-22,suite,5\n2026-11-23,standard,-1\n'));
    await u.click(screen.getByRole('button', { name: 'Check file' }));

    const table = await screen.findByRole('table', { name: 'Problems found, by row' });
    expect(within(table).getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    const [suite, negative] = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(
      within(suite as HTMLElement).getByText(
        'Room type "suite" is not sold here. Use one of: standard, deluxe',
      ),
    ).toBeInTheDocument();
    expect(within(suite as HTMLElement).getByText('suite')).toBeInTheDocument();
    expect(
      within(negative as HTMLElement).getByText('Rooms must be 0 or more'),
    ).toBeInTheDocument();
    expect(within(negative as HTMLElement).getByText('-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 rows' })).toBeDisabled();
  });

  it('offers no import when no row can be used', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv('date,room_type,rooms\n2026-11-01,standard,ten\n'));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText('Some rows have errors and will be skipped'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 rows' })).toBeDisabled();
  });

  it('refuses a file whose header is wrong before anything is uploaded', async () => {
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv('date,room_type\n2026-11-01,standard'));
    expect(await screen.findByText(/header row is missing: rooms/)).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
    expect(store.uploads.size).toBe(0);
  });

  describe('a file that cannot be read says why, under the file field', () => {
    const json = (text: string) => new File([text], 'inventory.json', { type: 'application/json' });
    it.each([
      [
        'not JSON',
        json('date,room_type,rooms'),
        'The file is not valid JSON. Check for a missing comma, quote or bracket.',
      ],
      [
        'JSON that is not a list of rows',
        json('{"items": []}'),
        'The JSON file must be a list of rows, or { "rows": [...] }.',
      ],
      [
        'JSON rows with the wrong columns',
        json('[{"day": "2026-11-01", "type": "standard", "rooms": 5}]'),
        'The rows are missing date, room_type and have unknown columns day, type. Expected: date, room_type, rooms.',
      ],
      ['an empty JSON list', json('[]'), 'The file has no data rows.'],
      [
        'a CSV header with a missing column',
        csv('date,room_type\n2026-11-01,standard'),
        'The header row is missing: rooms. Expected: date, room_type, rooms.',
      ],
      [
        'a CSV header with an unknown column',
        csv('date,room_type,rooms,price\n2026-11-01,standard,4,100'),
        'The header row has unknown columns: price. Expected: date, room_type, rooms.',
      ],
      ['an empty CSV', csv(''), 'The file is empty.'],
      ['a CSV with only a header', csv('date,room_type,rooms\n'), 'The file has no data rows.'],
    ])('%s', async (_label, file, message) => {
      const u = userEvent.setup();
      renderPage();
      await pick(u, file);
      await waitFor(() => expect(fileInput()).toHaveAttribute('aria-invalid', 'true'));
      expect(fileInput()).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
    });

    it('a file over 2 MB', async () => {
      const u = userEvent.setup();
      renderPage();
      await pick(u, csv(`date,room_type,rooms\n${'x'.repeat(2 * 1024 * 1024)}`));
      await waitFor(() =>
        expect(fileInput()).toHaveAccessibleDescription(expect.stringContaining('over 2 MB')),
      );
    });

    it('accepts { "rows": [...] }, like the server', async () => {
      const u = userEvent.setup();
      renderPage();
      await pick(
        u,
        json('{"rows": [{"date": "2026-11-01", "room_type": "standard", "rooms": 4}]}'),
      );
      expect(await screen.findByText('1 row read from the file')).toBeInTheDocument();
      expect(fileInput()).not.toHaveAttribute('aria-invalid');
      expect(screen.getByRole('button', { name: 'Check file' })).toBeEnabled();
    });
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
    // The empty cost and the empty rack rates are each imported as unknown, never zero.
    expect(screen.getAllByText('Empty: imported as unknown (null), not 0')).toHaveLength(3);

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
    expect(await screen.findByText('Could not check the file')).toBeInTheDocument();
    expect(screen.getByText('The file could not be uploaded.')).toBeInTheDocument();
    expect(screen.queryByText('The file passed the check')).not.toBeInTheDocument();
  });

  it("explains a refused import in the server's own words", async () => {
    server.use(
      http.post('*/v1/imports/:kind/:id/commit', () =>
        HttpResponse.json(
          problem('INVALID_STATE', { detail: 'No file has been uploaded for this import yet' }),
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const u = userEvent.setup();
    renderPage();
    await pick(u, csv(GOOD));
    await u.click(screen.getByRole('button', { name: 'Check file' }));
    await u.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    expect(await screen.findByText('Could not import the file')).toBeInTheDocument();
    expect(screen.getByText('No file has been uploaded for this import yet')).toBeInTheDocument();
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
