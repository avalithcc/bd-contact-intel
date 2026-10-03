/**
 * The list Mariel works from: a long run of never-touched contacts
 * (`status = new`, no activity). Everything here is about whether the list
 * can be trusted over many pages and many reloads.
 */
import { expect, test, type Page } from '@playwright/test';
import { meId, sql } from './helpers';

test.describe.configure({ mode: 'serial' });

const COHORT = 'paginacion-e2e';
const COHORT_NAME = 'Hotel Paginacion E2E';
const COHORT_SIZE = 160;

async function idsOnPage(page: Page, url: string): Promise<string[]> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const hrefs = await page
    .locator('tbody a[href^="/contacts/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter((h) => /^\/contacts\/[0-9a-f-]{36}$/.test(h)).map((h) => h.split('/').pop()!))];
}

test.beforeAll(async () => {
  await sql`delete from person where source_key = ${COHORT}`;
  await sql`insert into company (company_key, display_name) values (${COHORT}, ${COHORT_NAME}) on conflict do nothing`;
  const owner = await meId();
  await sql`
    insert into person (first_name, last_name, company, company_key, owner_bd_id, status, source_key, phone)
    select 'Pag' || lpad(g::text, 3, '0'), 'Cohorte', ${COHORT_NAME}, ${COHORT}, ${owner}, 'new', ${COHORT}, '+54 11 5550 ' || (1000 + g)
    from generate_series(1, ${COHORT_SIZE}) g`;
});

test.afterAll(async () => {
  await sql`delete from person where source_key = ${COHORT}`;
  await sql.end();
});

test('walking every page of an untouched cohort yields each contact exactly once', async ({ page }) => {
  const url = (n: number) => `/contacts?view=notContacted&company=${encodeURIComponent(COHORT_NAME)}&page=${n}`;
  const seen: string[] = [];
  for (let n = 1; n <= Math.ceil(COHORT_SIZE / 50); n++) seen.push(...(await idsOnPage(page, url(n))));
  const unique = new Set(seen);
  expect(seen.length, 'a contact appeared on two pages').toBe(unique.size);
  expect(unique.size, 'a contact was skipped between pages').toBe(COHORT_SIZE);
});

test('the same untouched list loads in the same order every time', async ({ page }) => {
  const url = `/contacts?view=notContacted&company=${encodeURIComponent(COHORT_NAME)}`;
  const first = await idsOnPage(page, url);
  for (let i = 0; i < 4; i++) expect(await idsOnPage(page, url)).toEqual(first);
});

// F4 (fixed): the default sort ends in a unique tiebreak, so an UPDATE cannot reshuffle ties.
test('the order is still the same after she edits a handful of contacts in it', async ({ page }) => {
  const url = `/contacts?view=notContacted&company=${encodeURIComponent(COHORT_NAME)}`;
  const before = await idsOnPage(page, url);
  // A session of small fixes (title, phone) over the visible page, last row first. Every UPDATE writes a
  // new row version at the end of the table; the unique tiebreak keeps the untouched contacts in place.
  for (const id of [...before].reverse()) await sql`update person set job_title = 'Gerente' where id = ${id}`;
  const after = await idsOnPage(page, url);
  expect(after).toEqual(before);
});

test('phone column shows mobile when there is no landline', async ({ page }) => {
  const owner = await meId();
  const [p] = await sql`
    insert into person (first_name, last_name, company, company_key, owner_bd_id, status, source_key, mobile_phone)
    values ('MobileOnly', 'Cohorte', ${COHORT_NAME}, ${COHORT}, ${owner}, 'new', ${COHORT}, '+54 9 11 5551 7777') returning id`;
  await page.goto(`/contacts?view=all&q=MobileOnly`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('tbody tr', { hasText: 'MobileOnly' });
  await expect(row).toContainText('5551 7777');
  await sql`delete from person where id = ${p!.id}`;
});

test('the "Tiene teléfono" chip does not read as "Todos" (i.e. filter off) while it is filtering', async ({ page }) => {
  await page.goto('/contacts?view=notContacted&hasPhone=1');
  await page.waitForLoadState('networkidle');
  const chip = page.locator('main').getByText(/Tiene teléfono/).first().locator('xpath=..');
  await expect(chip).toBeVisible();
  await expect(chip).not.toContainText('Todos');
  await expect(chip).toContainText('Sí');
});

test('from a record, the sidebar "Contactos" link returns to the list she was working, filters intact', async ({ page }) => {
  await page.goto('/contacts?view=notContacted&hasPhone=1');
  await page.waitForLoadState('networkidle');
  await page.locator('tbody a[href^="/contacts/"]').first().click();
  await page.waitForURL(/contacts\/[0-9a-f-]{36}/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Contactos', exact: true }).first().click();
  await page.waitForURL((u) => /^\/contacts\/?$/.test(u.pathname));
  await page.waitForLoadState('networkidle');
  expect(page.url(), 'filters were dropped on the way back').toMatch(/hasPhone=1/);
  expect(page.url()).toMatch(/view=notContacted/);
});
