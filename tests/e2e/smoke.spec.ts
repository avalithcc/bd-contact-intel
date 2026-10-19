import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
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
      // One visit, with a budget sized for a cold `next dev` compile of the route.
      test.setTimeout(120_000);
      const response = await page.goto(url, { timeout: 90_000 });
      await page.waitForLoadState('networkidle');
      expect(response?.status(), `${label}: HTTP status`).toBeLessThan(500);
      await expect(page, `Redirected to /login while opening ${url}: the saved session is missing or stale`).not.toHaveURL(/\/login/);
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

  test('phone click opens the outcome bar and the call dialog', async ({ page }) => {
    // Clicking a phone records a call attempt (a write), so scratch database only.
    skipUnlessWritesAllowed();
    test.setTimeout(120_000);
    await gotoAuthed(page, '/contacts?view=all');
    const hrefs = await page.locator('a[href^="/contacts/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    const hrefsWithId = hrefs.filter((h) => /^\/contacts\/[0-9a-f-]{36}$/.test(h));
    test.skip(hrefsWithId.length === 0, 'No contacts in the database to open.');
    // Not every contact has a phone: take the first one that does.
    let phone = page.locator('a.num[href^="tel:"]').first();
    for (const href of hrefsWithId.slice(0, 15)) {
      await page.goto(href, { timeout: 90_000 });
      await page.waitForLoadState('networkidle');
      if ((await phone.count()) > 0) break;
    }
    test.skip((await phone.count()) === 0, 'No contact with a phone number to click.');
    // Keep the browser on the page: cancel the tel: navigation, the React onClick still runs.
    await page.evaluate(() => document.addEventListener('click', (e) => {
      if ((e.target as Element).closest('a[href^="tel:"]')) e.preventDefault();
    }, true));
    await phone.click();
    const bar = page.locator('.outcome');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await bar.getByRole('button', { name: es.callAttempt.details }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(page.url()).toMatch(/\/contacts\//);
    await expectRendered(page, consoleErrors, 'call dialog');
  });
  test('connections import: first upload creates, the same file again reports no changes', async ({ page }) => {
    // Writes contacts, so scratch database only. Also proves csv-parse works in the real browser bundle.
    skipUnlessWritesAllowed();
    test.setTimeout(120_000);
    const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const csv = [
      'Notes:',
      '"When exporting your connections, you may notice that some of the email addresses are missing."',
      '',
      'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
      `Ana,Smoke${run},https://www.linkedin.com/in/zz-smoke-${run}-a,,Smoke Co ${run},Engineer,01 Jan 2025`,
      `Ben,Smoke${run},https://www.linkedin.com/in/zz-smoke-${run}-b,,Smoke Co ${run},Designer,02 Jan 2025`,
      '',
    ].join('\n');
    const file = { name: 'Connections.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
    const t = es.contactsImport;
    const form = page.locator('form', { has: page.locator('#connections-file') });

    await gotoAuthed(page, '/contacts/import');
    await form.locator('#connections-file').setInputFiles(file);
    await form.getByRole('button', { name: t.connectionsSubmit }).click();
    await expect(form.getByText(new RegExp(`${t.outcomeContactsCreated} 2\\b`))).toBeVisible({ timeout: 60_000 });
    await expect(form.getByText(t.connectionsErrorGenericFailed)).toHaveCount(0);
    await expect(form.getByText(t.connectionsErrorUnreadable)).toHaveCount(0);

    await form.locator('#connections-file').setInputFiles(file);
    await form.getByRole('button', { name: t.connectionsSubmit }).click();
    await expect(form.getByText(new RegExp(`${t.outcomeContactsUnchanged} 2\\b`))).toBeVisible({ timeout: 60_000 });
    await expect(form.getByText(new RegExp(`${t.outcomeContactsCreated} 0\\b`))).toBeVisible();
    await expect(form.getByText(t.connectionsErrorGenericFailed)).toHaveCount(0);
    await expectRendered(page, consoleErrors, 'connections import');
  });
});
