import { expect, test } from '@playwright/test';
import { buildQuote, goTo, issueQuote, openApp, signIn, signOut } from './helpers';

/**
 * Actions that change data, against the real local API (Track 1) and DynamoDB Local. Unlike
 * real-api.e2e.ts (previews only) this uses up rooms, so it needs a freshly seeded database and
 * is skipped unless E2E_REAL_API_ACTIONS=1:
 *
 *   docker rm -f c32-dynamodb; npm run db:up -w @c32/api; npm run seed -w @c32/api
 *   E2E_REAL_API_ACTIONS=1 E2E_BASE_URL=http://localhost:5175 npx playwright test e2e/real-api-actions.e2e.ts
 *
 * The API must allow the web origin (CORS_ORIGINS) and the web app must run with
 * VITE_API_MODE=api and VITE_AUTH_MODE=dev. The three rubric flows in rubric.e2e.ts also pass
 * against a fresh real database when run one at a time (-g "<test name>").
 */
test.describe('real API actions (fresh database)', () => {
  test.skip(
    process.env.E2E_REAL_API_ACTIONS !== '1',
    'Set E2E_REAL_API_ACTIONS=1 against a freshly seeded database.',
  );
  test.setTimeout(120_000);

  test('policy, import, exports, extend and cancel work end to end', async ({ page }) => {
    const unexpected: string[] = [];
    page.on('pageerror', (e) => unexpected.push(`page error: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().includes('favicon')) {
        unexpected.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      }
    });

    await openApp(page);
    await signIn(page, 'Meera', 'ServiceManager');

    // Policy: the real API starts at version 0, so the first save is version 1.
    await goTo(page, 'Policy');
    await expect(page.getByLabel(/Quote validity/)).toHaveValue('72');
    await page.getByLabel(/Quote validity/).fill('48');
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Policy saved as version 1.')).toBeVisible();

    // Import: rows with errors are skipped and listed, the good rows are imported, and an empty
    // cell is stored as unknown. This is how the real service behaves.
    await goTo(page, 'Imports and exports');
    await page.getByLabel(/File \(CSV or JSON\)/).setInputFiles({
      name: 'inventory.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,room_type,rooms\n2026-11-20,standard,10\n2026-11-21,standard,\n2026-11-22,standard,ten\n',
      ),
    });
    await page.getByRole('button', { name: 'Check file' }).click();
    const report = page.getByRole('table', { name: 'Problems found, by row' });
    await expect(report).toContainText('Empty: imported as unknown (null), not 0');
    await expect(report.getByText('Error')).toBeVisible();
    await expect(page.getByText('Some rows have errors and will be skipped')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await expect(page.getByText('Imported', { exact: true })).toBeVisible();

    await goTo(page, 'Availability');
    await page.getByLabel('First night').fill('2026-11-18');
    await page.getByLabel('Last night').fill('2026-11-25');
    await expect(page.getByRole('button', { name: /20 Nov.*10 of 10 free/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /21 Nov.*Unknown/ })).toBeVisible();
    // The row with an error (22 Nov) was skipped, so that night is still not on sale.
    await expect(page.getByRole('button', { name: /22 Nov.*Not on sale/ })).toBeVisible();

    // Exports: the links the API returns can be downloaded.
    await goTo(page, 'Imports and exports');
    await page.getByRole('button', { name: 'Get quotes download link' }).click();
    const quotesLink = page.getByRole('link', { name: /Download quotes/ });
    await expect(quotesLink).toBeVisible();
    const quotes = await page.request.get((await quotesLink.getAttribute('href')) as string);
    expect(quotes.status()).toBe(200);
    expect(await quotes.text()).toContain('quote_id');
    await page.getByRole('button', { name: 'Get evidence download link' }).click();
    const bundleLink = page.getByRole('link', { name: /Download evidence bundle/ });
    await expect(bundleLink).toBeVisible();
    const bundle = await page.request.get((await bundleLink.getAttribute('href')) as string);
    expect(bundle.status()).toBe(200);
    expect((await bundle.body()).length).toBeGreaterThan(100);

    // Extend and cancel a real quote (the fixture: 10 rooms at 2000 meets the floor).
    await signOut(page);
    await signIn(page, 'Asha', 'Reception');
    await buildQuote(page, { organiser: 'Actions Group', rooms: '10', rate: '2000' });
    await issueQuote(page, 'Issue quote');
    await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
    await page.getByRole('button', { name: 'Extend validity' }).click();
    await page.getByLabel('Extra hours').fill('6');
    await page.getByRole('dialog').getByRole('button', { name: 'Extend' }).click();
    await expect(page.getByText('Validity extended')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel quote' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel quote' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();

    expect(unexpected, 'unexpected failed requests or page errors').toEqual([]);
  });
});
