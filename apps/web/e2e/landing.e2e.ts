import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, openApp, signIn } from './helpers';

const HEADING = /Every group enquiry is a booking opportunity/;

test.describe('landing page', () => {
  test('is the front door and leads to sign-in', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });

    await openApp(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
    await expect(page).toHaveTitle(/StayQuote · Group bookings\. Quoted smarter\./);
    await page
      .getByRole('link', { name: /^Sign in/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await signIn(page, 'Asha', 'Sales');
    expect(problems).toEqual([]);
  });

  test('uses the bundled Inter font, with nothing loaded from another site', async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) {
        outside.push(r.url());
      }
    });
    await openApp(page, '/');
    await page.waitForTimeout(1200);
    const family = await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain('Inter Variable');
    expect(await page.evaluate(() => document.fonts.check("600 40px 'Inter Variable'"))).toBe(true);
    expect(outside).toEqual([]);
  });

  test('"Try a Group Quote" scrolls to the sample booking', async ({ page }) => {
    await openApp(page, '/');
    await page
      .getByRole('main')
      .getByRole('link', { name: /Try a Group Quote/ })
      .click();
    await expect(page.getByRole('heading', { name: /Know what the numbers say/ })).toBeInViewport();
  });

  test('the calculator answers as the product would, and celebrates a clean offer', async ({
    page,
  }) => {
    await openApp(page, '/');
    await page.getByRole('button', { name: '15% discount' }).click();
    const banner = page.locator('[role=status]', { hasText: 'Owner review required' });
    await expect(banner).toBeVisible();
    await expect(page.getByText('Contribution is below the contribution floor.')).toBeVisible();

    // Fixing the rate turns it into an offer, with a small burst of dots.
    await page.getByRole('button', { name: 'Use ₹1,800' }).click();
    await expect(page.locator('[role=status]', { hasText: 'Ready to offer' })).toBeVisible();
    await expect(page.locator('.lp-particle').first()).toBeVisible();

    await page.getByRole('button', { name: 'Too many rooms' }).click();
    await expect(page.locator('[role=status]', { hasText: 'Partial offer' })).toBeVisible();
    await expect(page.getByText(/You are 2 short/)).toBeVisible();

    await page.getByRole('button', { name: 'Breakfast cost unknown' }).click();
    await expect(page.getByRole('img', { name: /Contribution: Unknown/ })).toBeVisible();
  });

  test('the figures glide to their new value and settle on the exact one', async ({ page }) => {
    await openApp(page, '/');
    await page.getByRole('button', { name: '15% discount' }).click();
    await expect(page.getByText('₹18,000', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('-₹2,000', { exact: true }).first()).toBeVisible();
  });

  test('the negotiation tab shows what each discount does, and its marker slides', async ({
    page,
  }) => {
    await openApp(page, '/');
    const marker = page.locator('.lp-tab-marker');
    const before = await marker.evaluate((el) => (el as HTMLElement).style.left);
    await page.getByRole('tab', { name: 'Negotiation' }).click();
    await expect
      .poll(() => marker.evaluate((el) => (el as HTMLElement).style.left))
      .not.toBe(before);
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('₹22,000');
    await panel.getByRole('button', { name: '15% off' }).click();
    await expect(panel).toContainText('₹18,000');
    await expect(panel).toContainText('needs approval');
  });

  test('the hold clock holds, runs by itself, expires and releases rooms', async ({ page }) => {
    await openApp(page, '/');
    await page.getByRole('button', { name: 'Issue the quote' }).click();
    await expect(page.getByText('Quote issued: rooms are held')).toBeVisible();
    await page.getByLabel('Fast-forward time').fill('60');
    await expect(page.getByText('Expiring soon')).toBeVisible();
    await expect(page.locator('.lp-urgent')).toHaveCount(1);

    // "Run the clock" carries on to the end without anyone dragging the slider.
    await page.getByRole('button', { name: 'Run the clock' }).click();
    await expect(page.getByText('Expired: the rooms were released')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('list', { name: 'Ten rooms' }).getByText('Free')).toHaveCount(10);
  });

  test('the cards light up where the pointer is, and the hero card leans toward the mouse', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile === true, 'Pointer effects need a mouse.');
    await openApp(page, '/');
    await page.waitForTimeout(1500);
    const card = page.locator('.lp-tilt').first();
    const box = await card.boundingBox();
    if (!box) throw new Error('no hero card');
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.15, { steps: 5 });
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
    expect(
      await card.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--ry')),
    ).not.toBe('0deg');

    await page.evaluate(() => document.getElementById('familiar')?.scrollIntoView());
    await page.waitForTimeout(1400);
    const pain = page.locator('#familiar .lp-spot').first();
    const b = await pain.boundingBox();
    if (!b) throw new Error('no card');
    await page.mouse.move(b.x + 100, b.y + 80, { steps: 4 });
    await expect
      .poll(() => pain.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--cx')))
      .toBe('100px');
  });

  test('the menu follows the page, the header gains a shadow and a shortcut floats in', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile === true, 'The section menu is hidden on a phone.');
    await openApp(page, '/');
    await expect(page.locator('.lp-fab')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'FAQs' })
      .click();
    await expect(
      page.getByRole('heading', { name: /Questions a hotel owner would ask/ }),
    ).toBeInViewport();
    await expect(
      page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'FAQs' }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.lp-header')).toHaveAttribute('data-scrolled', 'true');
    await expect(page.locator('.lp-fab')).toBeVisible();
    await page.getByText('What if I do not know a cost yet?').click();
    await expect(page.getByText(/never as zero/)).toBeVisible();
  });

  test('has no accessibility violations, with real colour contrast', async ({ page }) => {
    // About a dozen audits of different states, each after its animations have settled.
    test.setTimeout(150_000);
    await openApp(page, '/');
    // Scroll through the whole page so every section has faded in, then let the animations settle.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 500) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2200);
    await expectNoA11yViolations(page, 'landing page');

    // Choosing a step pauses the tour; check each step's illustration once it has settled.
    for (const name of [
      'Enter the group booking details',
      'Calculate, check and negotiate',
      'Review and share your quotation',
    ]) {
      await page.getByRole('button', { name: new RegExp(`^0\\d\\s*${name}`) }).click();
      await page.waitForTimeout(1600);
      await expectNoA11yViolations(page, `landing page, tour step "${name}"`);
    }
    for (const tab of ['Pricing', 'Negotiation', 'Quotation']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(1600);
      await expectNoA11yViolations(page, `landing page, ${tab} tab`);
    }
    await page.getByText('Who can do what?').click();
    await page.getByRole('button', { name: 'Breakfast cost unknown' }).click();
    await page.getByRole('button', { name: 'Issue the quote' }).click();
    await page.waitForTimeout(1600);
    await expectNoA11yViolations(page, 'landing page, unknown, held and FAQ-open states');
  });

  test('shows everything at once, standing still, when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, '/');
    // Nothing waits for a scroll or an entrance: it is all in place straight away.
    await expect(page.locator('.lp-reveal').last()).toHaveCSS('opacity', '1');
    await expect(page.locator('.lp-word').first()).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
    await expect(page.locator('.lp-tilt').first()).toHaveCSS('transform', 'none');
    // Nothing is moving: no infinite animations are running anywhere on the page.
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
          .length,
    );
    expect(running).toBe(0);
    // And a good outcome does not throw dots around.
    await page.getByRole('button', { name: '15% discount' }).click();
    await page.getByRole('button', { name: 'Use ₹1,800' }).click();
    await expect(page.locator('.lp-particle')).toHaveCount(0);
  });
});
