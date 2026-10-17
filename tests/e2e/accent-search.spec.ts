import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { e2eBdEmail, ensureBd, openScratchDb, runTag, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.topBarSearch;

skipWithoutCredentials();
// Seeds contacts and a company directly: scratch only.
skipUnlessWritesAllowed();

/**
 * Accent- and case-insensitive search, with literal wildcards (shipped 2026-10-16; the rule is documented in
 * src/lib/search/accentInsensitive.ts and the SQL twin is pinned by tests/db/accentInsensitiveSearch.test.ts).
 * This is the browser side: the search box in the top bar, the URL it produces and the rows that come back.
 *
 * Seeded per run (every email and company key carries a random tag, and cleanup removes them):
 *   "José Pérez", "JOSE PEREZ", "Jose Perez", "Ana Peña", a last name with a literal `%`, one with a literal `_`
 *   and an unrelated control. Rows are recognised by their link (`/contacts/<id>`), never by position or total,
 *   so other data in the database cannot change a verdict.
 */

const tag = runTag();

let sql: ScratchSql;
let bdId: string;
const ids: Record<string, string> = {};
let companyKey: string;

const PEOPLE: Array<[key: string, first: string, last: string]> = [
  ['accents', 'José', 'Pérez'],
  ['upper', 'JOSE', 'PEREZ'],
  ['plain', 'Jose', 'Perez'],
  ['ene', 'Ana', 'Peña'],
  ['percent', 'Lia', 'Cien%Por'],
  ['underscore', 'Beto', 'Guion_Bajo'],
  ['control', 'Otro', 'Distinto'],
];
const JOSES = ['accents', 'upper', 'plain'];

test.beforeAll(async () => {
  sql = openScratchDb();
  try {
    bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    for (const [key, first, last] of PEOPLE) {
      const mail = `zzacc-${tag}-${key}@example.com`;
      const [p] = await sql`
        insert into person (first_name, last_name, email, email_normalized, owner_bd_id, status)
        values (${first}, ${last}, ${mail}, ${mail}, ${bdId}, 'new') returning id`;
      ids[key] = p!.id as string;
    }
    companyKey = `zzacc-penalver-${tag}`;
    await sql`insert into company (company_key, display_name, created_by_bd_id) values (${companyKey}, ${`Peñalver ZZAcc${tag} SA`}, ${bdId})`;
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

async function cleanup() {
  await sql`delete from person where email like ${`zzacc-${tag}-%`}`;
  await sql`delete from company where company_key = ${`zzacc-penalver-${tag}`}`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

const contactLink = (page: Page, key: string) => page.locator(`a[href="/contacts/${ids[key]}"]`);

/** Types in the top bar search box on /contacts, the way a BD does, and waits for the result page. */
async function searchContacts(page: Page, term: string) {
  await gotoAuthed(page, '/contacts?view=all');
  const box = page.getByRole('searchbox', { name: L.contactsLabel });
  await box.fill(term);
  await Promise.all([page.waitForURL((url) => url.searchParams.get('q') === term), box.press('Enter')]);
  await page.waitForLoadState('networkidle');
}

async function expectOnly(page: Page, found: string[]) {
  for (const [key] of PEOPLE) {
    if (found.includes(key)) await expect(contactLink(page, key).first(), `${key} should match`).toBeVisible();
    else await expect(contactLink(page, key), `${key} should NOT match`).toHaveCount(0);
  }
}

test.describe('Contacts search: case and accents', () => {
  test('"jose" finds José, JOSE and Jose, and nobody else', async ({ page }) => {
    await searchContacts(page, 'jose');
    await expectOnly(page, JOSES);
  });

  test('"José" (typed with the accent) finds the same three', async ({ page }) => {
    await searchContacts(page, 'José');
    await expectOnly(page, JOSES);
  });

  test('"JOSÉ" finds them too: case and accent fold together', async ({ page }) => {
    await searchContacts(page, 'JOSÉ');
    await expectOnly(page, JOSES);
  });

  test('"perez" and "PÉREZ" find the surname in all three spellings', async ({ page }) => {
    await searchContacts(page, 'perez');
    await expectOnly(page, JOSES);
    await searchContacts(page, 'PÉREZ');
    await expectOnly(page, JOSES);
  });

  test('"pena" finds Peña, and "PEÑA" finds her too, without matching the Pérez family', async ({ page }) => {
    await searchContacts(page, 'pena');
    await expectOnly(page, ['ene']);
    await searchContacts(page, 'PEÑA');
    await expectOnly(page, ['ene']);
  });

  test('two words are ANDed and each one is accent-insensitive: "jose perez"', async ({ page }) => {
    await searchContacts(page, 'jose perez');
    await expectOnly(page, JOSES);
    await searchContacts(page, 'josé ana');
    await expectOnly(page, []);
  });

  test('the term is a substring: "ere" finds Pérez but not Peña', async ({ page }) => {
    await searchContacts(page, 'ere');
    await expectOnly(page, JOSES);
  });
});

test.describe('Contacts search: wildcards typed by the user are literal', () => {
  test('"%" matches only the name that contains a percent sign, not everything', async ({ page }) => {
    await searchContacts(page, '%');
    await expectOnly(page, ['percent']);
  });

  test('"_" matches only the name that contains an underscore, not every single character', async ({ page }) => {
    await searchContacts(page, '_');
    await expectOnly(page, ['underscore']);
  });

  test('"j_se" and "jo%e" do not behave as patterns: José is not found', async ({ page }) => {
    await searchContacts(page, 'j_se');
    await expectOnly(page, []);
    await searchContacts(page, 'jo%e');
    await expectOnly(page, []);
  });

  test('a wildcard next to text stays literal: "cien%" finds the percent name, "cien_" does not', async ({ page }) => {
    await searchContacts(page, 'cien%');
    await expectOnly(page, ['percent']);
    await searchContacts(page, 'cien_');
    await expectOnly(page, []);
  });
});

test.describe('Companies search', () => {
  const companyLink = (page: Page) => page.locator(`a[href="/companies/${encodeURIComponent(companyKey)}"]`);

  async function searchCompanies(page: Page, term: string) {
    await gotoAuthed(page, '/companies');
    const box = page.getByRole('searchbox', { name: L.companiesLabel });
    await box.fill(term);
    await Promise.all([page.waitForURL((url) => url.searchParams.get('q') === term), box.press('Enter')]);
    await page.waitForLoadState('networkidle');
  }

  test('"penalver" and "PEÑALVER" find "Peñalver ... SA"', async ({ page }) => {
    await searchCompanies(page, 'penalver');
    await expect(companyLink(page).first()).toBeVisible();
    await searchCompanies(page, 'PEÑALVER');
    await expect(companyLink(page).first()).toBeVisible();
  });

  test('a typed "%" or "_" is literal on companies too', async ({ page }) => {
    await searchCompanies(page, 'pe%alver');
    await expect(companyLink(page)).toHaveCount(0);
    await searchCompanies(page, 'pe_alver');
    await expect(companyLink(page)).toHaveCount(0);
    await searchCompanies(page, '%');
    await expect(companyLink(page)).toHaveCount(0);
  });
});
