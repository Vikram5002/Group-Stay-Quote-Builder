import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildQuote, goTo, issueQuote, openApp, signIn } from './helpers';

/** True when something sticks out past the right edge, so the page would scroll sideways. */
async function overflowsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

async function expectFits(page: Page, where: string) {
  expect(await overflowsSideways(page), `${where} scrolls sideways on a phone`).toBe(false);
}

// Runs in the "mobile" project (a phone-sized viewport with touch).
test('every screen fits a phone without sideways scrolling', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await expectFits(page, 'sign-in');

  await signIn(page, 'Asha', 'Owner');
  await expectFits(page, 'dashboard');

  await buildQuote(page, { organiser: 'Phone Group', rate: '1700' });
  await expectFits(page, 'quote builder, review step');
  await issueQuote(page, 'Send for Owner review');
  await expect(page.getByRole('heading', { name: 'Audit timeline' })).toBeVisible();
  await expectFits(page, 'quote detail');

  for (const [menu, heading, ready] of [
    ['Dashboard', 'Dashboard', 'Pipeline by status'],
    ['Review queue', 'Review queue', 'Terms side by side'],
    ['Availability', 'Availability', '01 Nov'],
    ['Policy', 'Policy', 'Contribution floor'],
    ['Imports and exports', 'Imports and exports', 'Export'],
    ['Evidence', 'Evidence', 'Evidence ledger'],
    ['Experiment log', 'Experiment log', 'Log a contact'],
    ['Design system', 'Design system', 'Buttons'],
  ] as const) {
    await goTo(page, menu, heading);
    const marker =
      ready === '01 Nov'
        ? page.getByRole('button', { name: /01 Nov/ }).first()
        : page.getByRole('heading', { name: ready }).first();
    await expect(marker).toBeVisible();
    await expectFits(page, menu);
  }
});

test('primary actions are easy to touch', async ({ page }) => {
  await openApp(page);
  await signIn(page, 'Asha', 'Sales');
  await goTo(page, 'New quote');
  for (const control of [
    page.getByRole('button', { name: 'Next' }),
    page.getByLabel('Organiser name'),
    page.getByRole('link', { name: 'Availability' }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  }
});
