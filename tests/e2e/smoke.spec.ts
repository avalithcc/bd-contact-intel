import { test, expect } from './fixtures';
import { gotoAuthed, skipWithoutCredentials } from './helpers';
import { es } from '../../src/lib/i18n/dictionaries/es';
import { en } from '../../src/lib/i18n/dictionaries/en';

skipWithoutCredentials();

/**
 * Render smoke test: every main page must render at all. It exists because a
 * server component once called a plain function exported from a "use client"
 * file; unit tests, typecheck and the build passed, and every logged-in page
 * failed at render. Run it with `npm run smoke` (local stack, scratch database)
 * before pushing. Reads only: the guarded `test` fixture blocks writes.
 */

const BOUNDARY_TEXTS = [es.errorBoundary.body, en.errorBoundary.body];

async function expectRendered(page: import('@playwright/test').Page, consoleErrors: string[], label: string) {
  const text = await page.locator('body').innerText();
  for (const marker of BOUNDARY_TEXTS) {
    expect(text, `${label}: the app error boundary rendered`).not.toContain(marker);
  }
  expect(text, `${label}: Next error overlay text`).not.toMatch(/Attempted to call .* from the server/);
  const boundary = consoleErrors.filter((e) => e.includes('Attempted to call'));
  expect(boundary, `${label}: client/server boundary error in the console`).toEqual([]);
}

test.describe('render smoke', () => {
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
  });

  const pages = [
    ['/contacts', 'contacts list'],
    ['/account', 'account'],
    ['/tasks', 'tasks'],
    ['/sequences', 'sequences'],
    ['/capture/linkedin?url=https://www.linkedin.com/in/someone', 'linkedin capture'],
  ] as const;

  for (const [url, label] of pages) {
    test(`${label} renders`, async ({ page }) => {
      const response = await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(response?.status(), `${label}: HTTP status`).toBeLessThan(500);
      await gotoAuthed(page, url);
      await expectRendered(page, consoleErrors, label);
    });
  }

  test('contact record renders', async ({ page }) => {
    // Not openFirstContactOrSkip: that clicks and waits 15s, which a cold
    // `next dev` compile of the record route can exceed. Read the href, then
    // navigate with a budget sized for a cold compile (this test only).
    test.setTimeout(120_000);
    await gotoAuthed(page, '/contacts?view=all');
    const hrefs = await page.locator('a[href^="/contacts/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    const href = hrefs.find((h) => /^\/contacts\/[0-9a-f-]{36}$/.test(h));
    test.skip(!href, 'No contacts in the database to open.');
    const response = await page.goto(href!, { timeout: 90_000 });
    await page.waitForLoadState('networkidle');
    expect(response?.status(), 'contact record: HTTP status').toBeLessThan(500);
    await expectRendered(page, consoleErrors, 'contact record');
  });
});
