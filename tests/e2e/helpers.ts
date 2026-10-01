import { expect, test, type Page } from '@playwright/test';
import { skipReason } from './credentials';

/**
 * Call at the top of a spec file. Without E2E credentials, outside CI, every
 * test in the file is reported as skipped (with the reason) instead of
 * failing on a missing session. In CI it is a no-op, so a missing credential
 * still fails (auth.setup.ts throws).
 */
export function skipWithoutCredentials() {
  const reason = skipReason();
  test.skip(reason !== null, reason ?? '');
}

/**
 * Every route is auth-gated. A silent redirect to /login is what previously
 * made this suite report false passes, so assert we actually arrived.
 */
export async function gotoAuthed(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(
    page,
    `Redirected to /login while opening ${url}: the saved session (tests/.auth/state.json) ` +
      'is missing or STALE (its Supabase refresh token expired). Re-run the setup project: ' +
      '`npx playwright test --project=setup` (needs E2E_EMAIL/E2E_PASSWORD, see tests/e2e/README.md).',
  ).not.toHaveURL(/\/login/);
}

/**
 * Opens the first row of a list page, or skips with a reason if the list is
 * empty. Action links such as `/companies/new` live under the same prefix as
 * the rows, so they are excluded — otherwise an empty list silently navigates
 * to a create form and the test fails as if the feature were broken.
 */
export async function openFirstOrSkip(page: Page, hrefFragment: string, label: string) {
  const link = page
    .locator(`a[href*="${hrefFragment}"]`)
    .and(page.locator(`a:not([href$="/new"]):not([href$="/import"])`))
    .first();
  if ((await link.count()) === 0) {
    return { opened: false as const, reason: `No ${label} in the database to open.` };
  }
  const href = await link.getAttribute('href');
  await link.click();
  // networkidle resolves before Next finishes a client-side transition, which
  // leaves the test asserting against the list page it never left.
  await page.waitForURL(`**${href}`, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  return { opened: true as const };
}

/**
 * Opens the first contact RECORD of a /contacts list (default: every contact), or reports why it
 * could not. openFirstOrSkip cannot be used here: `/contacts/` also prefixes
 * the CSV export link (`/contacts/export?...`, which starts a download instead
 * of navigating) and `/contacts/import`, so only hrefs ending in a uuid count
 * as a record.
 */
export async function openFirstContactOrSkip(page: Page, listUrl = '/contacts?view=all') {
  await gotoAuthed(page, listUrl);
  const hrefs = await page
    .locator('a[href^="/contacts/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  const href = hrefs.find((h) => /^\/contacts\/[0-9a-f-]{36}$/.test(h));
  if (!href) return { opened: false as const, reason: 'No contacts in the database to open.' };
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForURL(`**${href}`, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  return { opened: true as const };
}
