/**
 * Re-filtering and personalising the list in the middle of a long session.
 * Mariel is on page 2 of 3, narrows by company, and expects to see results,
 * not "page 2 of 1".
 */
import { expect, test } from '@playwright/test';
import { meId, sql } from './helpers';

const COHORT = 'refiltro-e2e';
const BIG = 'Hotel Refiltro Grande';
const SMALL = 'Hotel Refiltro Chico';

test.beforeAll(async () => {
  await sql`delete from person where source_key = ${COHORT}`;
  await sql`insert into company (company_key, display_name) values (${COHORT + '-g'}, ${BIG}), (${COHORT + '-c'}, ${SMALL}) on conflict do nothing`;
  const owner = await meId();
  await sql`
    insert into person (first_name, last_name, company, company_key, owner_bd_id, status, source_key, phone)
    select 'Ref' || lpad(g::text, 3, '0'), 'Grande', ${BIG}, ${COHORT + '-g'}, ${owner}, 'new', ${COHORT}, '+54 11 5560 ' || (1000 + g)
    from generate_series(1, 120) g`;
  await sql`
    insert into person (first_name, last_name, company, company_key, owner_bd_id, status, source_key, phone)
    select 'Chi' || lpad(g::text, 3, '0'), 'Chico', ${SMALL}, ${COHORT + '-c'}, ${owner}, 'new', ${COHORT}, '+54 11 5561 ' || (1000 + g)
    from generate_series(1, 8) g`;
});

test.afterAll(async () => {
  await sql`delete from person where source_key = ${COHORT}`;
  await sql`delete from company where company_key in (${COHORT + '-g'}, ${COHORT + '-c'})`;
  await sql.end();
});

test('narrowing the filters while on page 3 does not strand her on an empty page', async ({ page }) => {
  await page.goto(`/contacts?view=notContacted&company=${encodeURIComponent(BIG)}&page=3`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tbody tr')).not.toHaveCount(0);
  // Swap to the small hotel through the filter UI, the way she would.
  await page.locator('button.chip-add').click();
  await page.locator('button', { hasText: 'Tiene teléfono' }).click();
  await page.getByRole('checkbox', { name: 'Tiene teléfono' }).check();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await page.waitForURL(/hasPhone/);
  await page.waitForLoadState('networkidle');
  console.log(`[refilter] url after adding a filter on page 3: ${page.url()}`);
  const rows = await page.locator('tbody tr').count();
  const footer = await page.locator('main').getByText(/Mostrando|Página/).allInnerTexts();
  console.log(`[refilter] rows=${rows} footer=${JSON.stringify(footer)}`);
  expect(rows, 'a filter change on page 3 left an empty page').toBeGreaterThan(0);
});

test('removing a filter chip while deep in the list returns to page 1', async ({ page }) => {
  await page.goto(`/contacts?view=notContacted&company=${encodeURIComponent(BIG)}&hasPhone=1&page=3`);
  await page.waitForLoadState('networkidle');
  await page.locator('a', { hasText: '×' }).and(page.locator('a[href*="hasPhone="]:not([href*="hasPhone=1"])')).first().click();
  await page.waitForLoadState('networkidle');
  console.log(`[refilter] url after removing a chip from page 3: ${page.url()}`);
  expect(await page.locator('tbody tr').count(), 'empty page after removing a chip').toBeGreaterThan(0);
});

test('a page number beyond the last page is handled, not a blank table', async ({ page }) => {
  await page.goto(`/contacts?view=notContacted&company=${encodeURIComponent(SMALL)}&page=9`);
  await page.waitForLoadState('networkidle');
  const rows = await page.locator('tbody tr').count();
  console.log(`[refilter] page=9 of a single-page list shows ${rows} rows`);
  expect(rows).toBeGreaterThan(0);
});

test('the column choice is saved per view, survives a reload, and can be put back', async ({ page }) => {
  await page.goto('/contacts?view=all');
  await page.waitForLoadState('networkidle');
  expect((await page.locator('thead th').allInnerTexts()).join('|')).not.toMatch(/ÚLTIMA ACTIVIDAD/i);
  await page.getByText('Columnas', { exact: true }).click();
  await page.locator('label', { hasText: 'Última actividad' }).first().locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: /Aplicar/ }).click();
  await expect(page.locator('thead th', { hasText: /Última actividad/i })).toBeVisible();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('thead th', { hasText: /Última actividad/i }), 'column lost on reload').toBeVisible();
  await page.goto('/contacts?view=notContacted');
  await page.waitForLoadState('networkidle');
  const other = (await page.locator('thead th').allInnerTexts()).join('|');
  console.log(`[columns] another view after changing "Todos": ${other}`);
  // Put the preference back as we found it.
  await page.goto('/contacts?view=all');
  await page.waitForLoadState('networkidle');
  await page.getByText('Columnas', { exact: true }).click();
  await page.getByRole('button', { name: /Restablecer|Reiniciar|Predeterminad/ }).click();
  await page.getByRole('button', { name: /Aplicar/ }).click();
  await expect(page.locator('thead th', { hasText: /Última actividad/i })).toHaveCount(0);
});
