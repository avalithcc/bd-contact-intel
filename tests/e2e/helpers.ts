import { expect, type Page } from '@playwright/test';

/**
 * Every route is auth-gated. A silent redirect to /login is what previously
 * made this suite report false passes, so assert we actually arrived.
 */
export async function gotoAuthed(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(
    page,
    `Redirected to /login while opening ${url} — the test session is not authenticated.`,
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
