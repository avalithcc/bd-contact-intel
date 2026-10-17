import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { ADMIN_STORAGE_STATE, e2eAdminEmail, e2eBdEmail, ensureBd, openScratchDb, runTag, saveLoginState, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.contactRecord;
const A = es.lushaAdmin;

skipWithoutCredentials();
// Flips the Lusha switch of seeded BDs and writes audit rows: scratch only.
skipUnlessWritesAllowed();

/**
 * Lusha per BD (lusha-per-bd, shipped 2026-10-16): `bd.lusha_enabled` decides who may spend the team's shared Lusha credits.
 *
 * NOTHING HERE CALLS LUSHA. The scratch app server gets no LUSHA_API_KEY (the e2e env blanks every key outside the three it is
 * given), and every test stops at the gate: the BD tests only read what the record offers (a reason, or a control) and never
 * click a priced button; any browser request to a Lusha host is additionally aborted and counted, and the test fails if one
 * was made.
 *
 * Two real accounts: the shared `chromium` session is the BD (`E2E_EMAIL`), the admin tests use the second login. The admin
 * flips a throwaway BD seeded for this run, never a real one. The e2e BD's own switch is restored in afterAll.
 */

const tag = runTag();
const otherBdEmail = `zz-lusha-other-${tag}@example.test`;
const otherBdName = `ZZ E2E Lusha ${tag}`;

let sql: ScratchSql;
let bdId: string;
let adminId: string;
let otherBdId: string;
let personId: string;
let originalEnabled: boolean;

const setBdEnabled = (enabled: boolean) => sql`update bd set lusha_enabled = ${enabled} where id = ${bdId}`;
const named = (template: string) => template.replace('{name}', otherBdName);

test.beforeAll(async ({ browser }) => {
  sql = openScratchDb();
  try {
    bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    adminId = await ensureBd(sql, e2eAdminEmail(), 'ZZ E2E Admin (no asignar)', 'admin');
    otherBdId = await ensureBd(sql, otherBdEmail, otherBdName, 'bd');
    // ensureBd upserts and a new BD takes the column default (false); an existing one keeps its own value.
    await sql`update bd set lusha_enabled = false where id = ${otherBdId}`;
    const [row] = await sql`select lusha_enabled from bd where id = ${bdId}`;
    originalEnabled = row!.lusha_enabled as boolean;
    // No email and no phone: the record offers Lusha on both rows (a contact that can already be sequenced is never offered one).
    const [p] = await sql`
      insert into person (first_name, last_name, company, company_key, job_title, owner_bd_id, status)
      values (${`ZzLusha${tag}`}, 'Acceso', 'Acme Pruebas', 'acme-pruebas', 'CTO', ${bdId}, 'new') returning id`;
    personId = p!.id as string;

    const baseURL = test.info().project.use.baseURL;
    if (!baseURL) throw new Error('baseURL is not configured');
    await saveLoginState(browser, baseURL, e2eAdminEmail(), ADMIN_STORAGE_STATE);
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

async function cleanup() {
  if (bdId !== undefined && originalEnabled !== undefined) await setBdEnabled(originalEnabled);
  await sql`delete from person where first_name = ${`ZzLusha${tag}`}`;
  if (otherBdId) {
    await sql`delete from audit_log where target_bd_id = ${otherBdId}`;
    await sql`delete from bd where id = ${otherBdId}`;
  }
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

/** Aborts any browser request to a Lusha host and returns the list of those attempted (must stay empty). */
async function blockLusha(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(/lusha\.com/i, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
  return hits;
}

const lushaControl = (page: Page) => page.locator('dd.row button', { hasText: /Buscar|Revelar/ });

test.describe('Lusha per BD: the BD side of the gate', () => {
  test('a BD without access sees the reason on the email and phone rows and no way to spend', async ({ page }) => {
    const hits = await blockLusha(page);
    await setBdEnabled(false);
    await gotoAuthed(page, `/contacts/${personId}`);
    await expect(page.locator('.record-identity h1')).toContainText(`ZzLusha${tag}`);

    await expect(page.getByText(L.lushaNoteNotEnabled, { exact: true })).toBeVisible();
    await expect(page.getByText(L.lushaNoteNotEnabledShort, { exact: true })).toBeVisible();
    // No button at all (a grey one would invite "why?"), and nothing was sent to Lusha.
    await expect(lushaControl(page)).toHaveCount(0);
    expect(hits).toEqual([]);
  });

  test('with the switch on the reason is gone and the control is offered; it is never clicked here', async ({ page }) => {
    const hits = await blockLusha(page);
    await setBdEnabled(true);
    await gotoAuthed(page, `/contacts/${personId}`);
    await expect(page.locator('.record-identity h1')).toContainText(`ZzLusha${tag}`);

    await expect(page.getByText(L.lushaNoteNotEnabled, { exact: true })).toHaveCount(0);
    await expect(page.getByText(L.lushaNoteNotEnabledShort, { exact: true })).toHaveCount(0);
    // The control is there. The scratch server has no API key, so it is disabled and says why instead of being clickable.
    await expect(lushaControl(page).first()).toBeVisible();
    await expect(lushaControl(page).first()).toBeDisabled();
    await expect(page.getByText(L.lushaNoteUnconfigured, { exact: true })).toBeVisible();
    expect(hits).toEqual([]);
  });

  test('a BD cannot open the Lusha admin screen', async ({ page }) => {
    const response = await page.goto('/admin/lusha');
    expect(response?.status()).toBe(404);
  });
});

test.describe('Lusha per BD: the admin switch', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('enabling asks for confirmation, then records the change; disabling applies at once', async ({ page }) => {
    await gotoAuthed(page, '/admin/lusha');
    const row = page.locator('table.data tbody tr', { hasText: otherBdEmail });
    await expect(row).toHaveCount(1);
    // A BD created after the migration starts disabled.
    const off = row.getByRole('checkbox', { name: named(A.ariaDisabled) });
    await expect(off).not.toBeChecked();

    await off.click();
    const dialog = page.getByRole('dialog', { name: named(A.dialogTitle) });
    await expect(dialog).toBeVisible();
    // Cancelling changes nothing.
    await dialog.getByRole('button', { name: A.cancel, exact: true }).click();
    await expect(dialog).toBeHidden();
    const [still] = await sql`select lusha_enabled from bd where id = ${otherBdId}`;
    expect(still!.lusha_enabled).toBe(false);

    await off.click();
    await page.getByRole('dialog', { name: named(A.dialogTitle) }).getByRole('button', { name: A.dialogConfirm, exact: true }).click();
    // The first server action of a cold dev server compiles on demand: give it room.
    const on = row.getByRole('checkbox', { name: named(A.ariaEnabled) });
    await expect(on).toBeChecked({ timeout: 30_000 });
    await expect(page.getByText(named(A.toastEnabled))).toBeVisible();
    const [enabled] = await sql`select lusha_enabled from bd where id = ${otherBdId}`;
    expect(enabled!.lusha_enabled).toBe(true);
    const audit = await sql`select actor_bd_id, action from audit_log where target_bd_id = ${otherBdId} order by at`;
    expect(audit.map((r) => [r.actor_bd_id, r.action])).toEqual([[adminId, 'bd_lusha_enable']]);

    // Turning it off needs no dialog.
    await on.click();
    await expect(page.getByText(named(A.toastDisabled))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const [disabled] = await sql`select lusha_enabled from bd where id = ${otherBdId}`;
    expect(disabled!.lusha_enabled).toBe(false);
    const after = await sql`select action from audit_log where target_bd_id = ${otherBdId} order by at`;
    expect(after.map((r) => r.action)).toEqual(['bd_lusha_enable', 'bd_lusha_disable']);
  });
});
