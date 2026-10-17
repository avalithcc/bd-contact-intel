import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { e2eBdEmail, ensureBd, openScratchDb, runTag, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.hiring;

skipWithoutCredentials();
// Seeds target companies, postings and contacts directly: scratch only.
skipUnlessWritesAllowed();

/**
 * The /hiring view ("vacantes abiertas"): one row per target company with exactly three columns (Empresa, Vacantes de IT,
 * Mis contactos; mockups/hiring.html). Two companies are seeded per run, each key and name carrying a random tag so rows are
 * found by name and other data in the database cannot change a verdict:
 *   - LATAM: 2 open IT postings in LATAM, 1 closed IT posting and 1 open non-IT posting (neither may count), and 2 of the
 *     e2e BD's own LinkedIn contacts working there.
 *   - US: 1 open IT posting in the US, classified as a startup, and no contacts.
 */

const tag = runTag();
const LATAM_KEY = `zzhir-latam-${tag}`;
const US_KEY = `zzhir-us-${tag}`;
const LATAM_NAME = `ZZ Hiring Latam ${tag}`;
const US_NAME = `ZZ Hiring Us ${tag}`;

let sql: ScratchSql;

async function seedCompany(key: string, name: string, isStartup: boolean | null) {
  await sql`insert into target_company (company_key, display_name, ats, config, is_startup) values (${key}, ${name}, 'greenhouse', ${sql.json({})}, ${isStartup})`;
}

async function seedPosting(key: string, n: number, o: { location: string; market: 'latam' | 'us'; isIt?: boolean; closed?: boolean }) {
  await sql`
    insert into job_posting (company_key, external_id, title, location, url, posted_at, is_it, first_seen, closed_at, market)
    values (${key}, ${`${tag}-${key}-${n}`}, ${`Engineer ${n}`}, ${o.location}, ${`https://example.test/${key}/${n}`}, now() - interval '2 days',
      ${o.isIt ?? true}, now() - interval '2 days', ${o.closed ? sql`now() - interval '1 day'` : null}, ${o.market})`;
}

test.beforeAll(async () => {
  sql = openScratchDb();
  try {
    const bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    await seedCompany(LATAM_KEY, LATAM_NAME, null);
    await seedPosting(LATAM_KEY, 1, { location: 'Buenos Aires, Argentina', market: 'latam' });
    await seedPosting(LATAM_KEY, 2, { location: 'Bogota, Colombia', market: 'latam' });
    await seedPosting(LATAM_KEY, 3, { location: 'Buenos Aires, Argentina', market: 'latam', closed: true });
    await seedPosting(LATAM_KEY, 4, { location: 'Buenos Aires, Argentina', market: 'latam', isIt: false });
    for (const n of [1, 2]) {
      await sql`insert into contact (bd_id, profile_key, first_name, last_name, company, company_key) values (${bdId}, ${`linkedin.com/in/zzhir-${tag}-${n}`}, ${`ZzHir${n}`}, 'Contacto', ${LATAM_NAME}, ${LATAM_KEY})`;
    }
    await seedCompany(US_KEY, US_NAME, true);
    await seedPosting(US_KEY, 1, { location: 'Austin, TX, United States', market: 'us' });
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

async function cleanup() {
  await sql`delete from contact where profile_key like ${`linkedin.com/in/zzhir-${tag}-%`}`;
  // job_posting cascades from target_company.
  await sql`delete from target_company where company_key in (${LATAM_KEY}, ${US_KEY})`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

test.describe('Hiring: the three-column table', () => {
  test('renders Empresa, Vacantes de IT and Mis contactos for the seeded companies', async ({ page }) => {
    await gotoAuthed(page, '/hiring');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(L.title);

    const headers = page.locator('table.data thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers).toHaveText([L.colCompany, L.colVacancies, L.colContacts]);

    const latam = page.locator('table.data tbody tr', { hasText: LATAM_NAME });
    await expect(latam).toHaveCount(1);
    await expect(latam.locator('td')).toHaveCount(3);
    // Only the 2 open IT postings count: the closed one and the non-IT one do not.
    await expect(latam.getByRole('link', { name: L.vacanciesLinkLabel(2, LATAM_NAME) })).toHaveText('2');
    await expect(latam.getByRole('link', { name: L.contactCount(2) })).toHaveAttribute('href', `/?companyKey=${encodeURIComponent(LATAM_KEY)}`);

    const us = page.locator('table.data tbody tr', { hasText: US_NAME });
    await expect(us).toHaveCount(1);
    await expect(us.locator('td')).toHaveCount(3);
    await expect(us.getByRole('link', { name: L.vacanciesLinkLabel(1, US_NAME) })).toHaveText('1');
    await expect(us).toContainText(L.startupBadge);
    // No contacts: plain text, not a link.
    await expect(us.getByText(L.contactCount(0), { exact: true })).toBeVisible();
    await expect(us.getByRole('link', { name: L.contactCount(0) })).toHaveCount(0);
  });

  test('the market segments narrow the same three-column table', async ({ page }) => {
    await gotoAuthed(page, '/hiring');
    const segments = page.getByRole('group', { name: L.marketGroupLabel });
    await expect(segments.getByRole('link', { name: L.allMarketsLabel })).toHaveAttribute('aria-current', 'true');

    await segments.getByRole('link', { name: es.markets.latam, exact: true }).click();
    await expect(page).toHaveURL(/market=latam/);
    await expect(page.locator('table.data tbody tr', { hasText: LATAM_NAME })).toHaveCount(1);
    await expect(page.locator('table.data tbody tr', { hasText: US_NAME })).toHaveCount(0);
    await expect(page.locator('table.data thead th')).toHaveCount(3);

    await segments.getByRole('link', { name: L.marketUs, exact: true }).click();
    await expect(page).toHaveURL(/market=us/);
    await expect(page.locator('table.data tbody tr', { hasText: US_NAME })).toHaveCount(1);
    await expect(page.locator('table.data tbody tr', { hasText: LATAM_NAME })).toHaveCount(0);
  });

  test('"Solo startups" keeps only the classified startup', async ({ page }) => {
    await gotoAuthed(page, '/hiring?startupsOnly=on');
    await expect(page.locator('table.data tbody tr', { hasText: US_NAME })).toHaveCount(1);
    await expect(page.locator('table.data tbody tr', { hasText: LATAM_NAME })).toHaveCount(0);
  });
});
