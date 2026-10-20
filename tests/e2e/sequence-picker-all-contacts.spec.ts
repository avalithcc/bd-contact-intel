import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { e2eBdEmail, ensureBd, openScratchDb, runTag, type ScratchSql } from './scratchDb';

skipWithoutCredentials();
// Seeds people and postings straight into the database: scratch only.
skipUnlessWritesAllowed();

/**
 * The create-Sequence picker lists EVERY live contact with an email. Florida / Miami and "Contratando IT en EE. UU."
 * are filters the BD turns on, never the pool. A contact the compliance audience cannot place (no location, or an embargoed country) is
 * listed as blocked, hidden until "Mostrar los que no se pueden agregar", and cannot be chosen.
 *
 * Three synthetic contacts share one last name so a search isolates them: an Argentine one (no posting at all), one at a
 * company with a Miami posting and one at a company with an Austin posting. A fourth lives in Cuba (embargoed, so the compliance audience holds it).
 */

const tag = runTag();
const LAST = `Zzpick${tag}`;
const MAIL = (n: string) => `zzpick-${n}-${tag}@example.com`;
const KEYS = { fl: `zz-pick-fl-${tag}`, tx: `zz-pick-tx-${tag}` };
const NAME = { ar: `Ana ${LAST}`, fl: `Flor ${LAST}`, tx: `Tex ${LAST}`, es: `Esp ${LAST}` };

let sql: ScratchSql;

async function cleanup() {
  await sql`delete from person where email like ${`zzpick-%-${tag}@example.com`}`;
  // job_posting cascades from target_company.
  await sql`delete from target_company where company_key in (${KEYS.fl}, ${KEYS.tx})`;
}

async function mkPosting(key: string, location: string, miami: boolean) {
  await sql`insert into target_company (company_key, display_name, ats, config) values (${key}, ${key}, 'greenhouse', ${sql.json({})})`;
  await sql`
    insert into job_posting (company_key, external_id, title, location, url, posted_at, is_it, first_seen, market, is_miami)
    values (${key}, '1', 'Engineer', ${location}, 'https://example.test', now(), true, now(), 'us', ${miami})`;
}

async function mkPerson(first: string, mailKey: string, company: string | null, country: string | null) {
  await sql`
    insert into person (first_name, last_name, email, email_normalized, email_status, email_source, company, company_key, country, status)
    values (${first}, ${LAST}, ${MAIL(mailKey)}, ${MAIL(mailKey)}, 'verified', 'apollo', ${company}, ${company}, ${country}, 'new')`;
}

test.beforeAll(async () => {
  sql = openScratchDb();
  try {
    await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    await mkPosting(KEYS.fl, 'Miami, FL', true);
    await mkPosting(KEYS.tx, 'Austin, TX', false);
    await mkPerson('Ana', 'ar', null, 'Argentina');
    await mkPerson('Flor', 'fl', KEYS.fl, null);
    await mkPerson('Tex', 'tx', KEYS.tx, null);
    await mkPerson('Esp', 'es', null, 'Cuba');
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

for (const width of [1024, 1440]) {
  test(`the picker lists every contact, Florida is only a filter, and a region without a legal footer is blocked (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoAuthed(page, '/sequences/new');

    const search = page.getByRole('searchbox', { name: 'Buscar contactos para la secuencia' });
    await search.fill(LAST);
    const row = (name: string) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

    // Default: no filter is pressed, and a contact outside the US (no posting at all) is in the list.
    for (const chip of ['Florida / Miami', 'Contratando IT en EE. UU.', 'Mis contactos']) {
      await expect(page.getByRole('button', { name: chip, pressed: false })).toBeVisible();
    }
    await expect(row(NAME.ar)).toBeVisible();
    await expect(row(NAME.fl)).toBeVisible();
    await expect(row(NAME.tx)).toBeVisible();
    // Screenshot first, so a failing layout assertion still leaves an image.
    await page.locator('.table-wrap').screenshot({ path: `test-results/sequence-picker-all-contacts-${width}.png` });
    // Cuba is embargoed: blocked, so hidden until the toggle.
    await expect(row(NAME.es)).toHaveCount(0);

    // Florida narrows: the Miami posting stays, the Argentine and the Austin ones go.
    await page.getByRole('button', { name: 'Florida / Miami' }).click();
    await expect(page.getByRole('button', { name: 'Florida / Miami', pressed: true })).toBeVisible();
    await expect(row(NAME.fl)).toBeVisible();
    await expect(row(NAME.ar)).toHaveCount(0);
    await expect(row(NAME.tx)).toHaveCount(0);

    // Hiring keeps the two companies with an open US IT posting; with Florida off again the Austin one is back.
    await page.getByRole('button', { name: 'Florida / Miami' }).click();
    await page.getByRole('button', { name: 'Contratando IT en EE. UU.' }).click();
    await expect(row(NAME.tx)).toBeVisible();
    await expect(row(NAME.fl)).toBeVisible();
    await expect(row(NAME.ar)).toHaveCount(0);
    await page.getByRole('button', { name: 'Contratando IT en EE. UU.' }).click();
    await expect(row(NAME.ar)).toBeVisible();

    // The blocked contact appears with its reason and cannot be chosen.
    await page.getByLabel('Mostrar los que no se pueden agregar').check();
    const spain = row(NAME.es);
    await expect(spain).toBeVisible();
    await expect(spain).toContainText('Ubicación desconocida o restringida');
    await expect(spain.getByRole('checkbox')).toBeDisabled();

    // An addable contact can be chosen; the counter follows.
    await row(NAME.ar).getByRole('checkbox').check();
    await expect(page.getByRole('region', { name: 'Contactos elegidos' })).toContainText('1 elegido');

    // No horizontal page scroll, and the table stays inside its card.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const [wrap, card] = await Promise.all([page.locator('.table-wrap').boundingBox(), page.locator('.card', { has: page.locator('.table-wrap') }).boundingBox()]);
    expect(wrap && card).toBeTruthy();
    expect(wrap!.x + wrap!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  });
}
