import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Pin the browser clock so the November 2026 case dates stay in the future. */
export const NOW = '2026-10-20T06:00:00Z';

/**
 * The mock API keeps its data in memory, so a full page load resets it. Tests therefore load the
 * app once and move around with the menu, as a person would.
 */
export async function openApp(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

export async function signIn(page: Page, name: string, role: 'Sales' | 'Owner' | 'Viewer') {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Role').selectOption(role);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

export async function goTo(page: Page, menuName: string, heading = menuName) {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: menuName })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

interface QuoteInput {
  organiser: string;
  checkIn?: string;
  nights?: string;
  rooms?: string;
  roomType?: string;
  rate?: string;
}

/** Fill the quote builder and stop on the review step. */
export async function buildQuote(page: Page, input: QuoteInput) {
  await goTo(page, 'New quote');
  // An earlier quote left unissued in this tab is offered as a draft; these flows start afresh.
  const startOver = page.getByRole('button', { name: 'Start over' });
  if (await startOver.isVisible()) await startOver.click();
  await page.getByLabel('Organiser name').fill(input.organiser);
  await page.getByLabel('Check-in date').fill(input.checkIn ?? '2026-11-01');
  if (input.nights) await page.getByLabel('Nights').fill(input.nights);
  await page.getByRole('button', { name: 'Next' }).click();

  if (input.roomType) await page.getByLabel('Room type').selectOption(input.roomType);
  if (input.rooms) await page.getByLabel(/^Rooms/).fill(input.rooms);
  await page.getByRole('button', { name: 'Next' }).click();

  if (input.rate) await page.getByLabel('Rate per room per night (INR)').fill(input.rate);
  await page.getByRole('button', { name: 'Next' }).click();
}

export async function issueQuote(page: Page, buttonName: 'Issue quote' | 'Send for Owner review') {
  const button = page.getByRole('button', { name: buttonName });
  await expect(button).toBeEnabled();
  await button.click();
}

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fails with a readable list of rule ids, counts and the first offending element. */
export async function expectNoA11yViolations(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} x${v.nodes.length}, e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `Accessibility problems on ${where}`).toEqual([]);
}
