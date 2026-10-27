import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipReason } from './credentials';
import { writeSkipReason } from './readOnlyGuard';

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
 * Server-rendered buttons are visible and enabled before React hydrates them, and a click in
 * that window is a silent no-op (no handler yet). `networkidle` does not cover it: hydration can
 * still be running after the network goes quiet, and `page.reload()` does not wait for it at all.
 * React records a node's props under a `__reactProps$<id>` key at the moment it hydrates that
 * node, so "has an `onXxx` function prop there" is the hydration-ready signal for the element.
 * Self-contained on purpose: Playwright serialises it into the page.
 */
export function hasHydratedHandler(el: Element): boolean {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  if (!key) return false;
  const props = (el as unknown as Record<string, Record<string, unknown>>)[key] ?? {};
  return Object.entries(props).some(([name, value]) => /^on[A-Z]/.test(name) && typeof value === 'function');
}

/** Waits until React has attached its handler to the (single) element the locator points at. */
export async function waitUntilHydrated(target: Locator) {
  await expect
    .poll(() => target.evaluate(hasHydratedHandler), { message: 'React has not hydrated this control yet (no handler attached)' })
    .toBe(true);
}

/** Click that cannot land before hydration. Use for the first interaction after a navigation or reload. */
export async function clickHydrated(target: Locator) {
  await waitUntilHydrated(target);
  await target.click();
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

/**
 * Call inside a test that writes (a server action, an import, a merge, or a
 * page render that writes an audit row). Skips unless DATABASE_URL is a
 * scratch database; against anything else, including production, the suite
 * is read-only. See readOnlyGuard.ts and tests/e2e/README.md.
 */
export function skipUnlessWritesAllowed() {
  const reason = writeSkipReason(process.env.DATABASE_URL);
  test.skip(reason !== null, reason ?? '');
}
