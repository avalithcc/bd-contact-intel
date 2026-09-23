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

/** Opens the first row of a list page, or skips with a reason if the list is empty. */
export async function openFirstOrSkip(page: Page, hrefFragment: string, label: string) {
  const link = page.locator(`a[href*="${hrefFragment}"]`).first();
  if ((await link.count()) === 0) {
    return { opened: false as const, reason: `No ${label} in the database to open.` };
  }
  await link.click();
  await page.waitForLoadState('networkidle');
  return { opened: true as const };
}
