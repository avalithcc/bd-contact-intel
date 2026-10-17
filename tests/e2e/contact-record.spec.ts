import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { ADMIN_STORAGE_STATE, e2eAdminEmail, e2eBdEmail, ensureBd, openScratchDb, runTag, saveLoginState, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.contactRecord;

skipWithoutCredentials();
// Seeds contacts and notes directly and deletes a note through the app: scratch only.
skipUnlessWritesAllowed();

/**
 * The contact record: deleting a note (contact-note-delete), the LinkedIn badge (contact-linkedin) and the
 * role group that is hidden on purpose (commit 78a1063d: not a row on the record, not a column in the list).
 *
 * Who may delete a note is the author or an admin (src/lib/activity/noteDelete.ts). The shared `chromium`
 * session is the BD; the admin tests use the second login through `test.use({ storageState })`. Everything
 * seeded carries a per-run tag and is removed in afterAll.
 */

const tag = runTag();

let sql: ScratchSql;
let bdId: string;
let adminId: string;
let otherBdId: string;
const otherBdEmail = `zz-note-other-${tag}@example.test`;
let notePerson: string;
let linkedinPerson: string;
let bareLinkedinPerson: string;
let rolePerson: string;
const profileKey = `linkedin.com/in/zz-e2e-${tag}`;

async function seedPerson(first: string, extra: { profileKey?: string; jobTitle?: string; roleGroup?: string } = {}): Promise<string> {
  const mail = `zzrec-${tag}-${first.toLowerCase()}@example.com`;
  const [p] = await sql`
    insert into person (first_name, last_name, email, email_normalized, company, company_key, job_title, role_group, profile_key, owner_bd_id, status)
    values (${first}, ${`Ficha${tag}`}, ${mail}, ${mail}, 'Acme Pruebas', 'acme-pruebas', ${extra.jobTitle ?? 'CTO'}, ${extra.roleGroup ?? null}, ${extra.profileKey ?? null}, ${bdId}, 'new')
    returning id`;
  return p!.id as string;
}

async function seedNote(personId: string, actorBdId: string, text: string): Promise<string> {
  const [a] = await sql`
    insert into activity (type, person_id, actor_bd_id, metadata)
    values ('note', ${personId}, ${actorBdId}, ${sql.json({ note: text })}) returning id`;
  return a!.id as string;
}

test.beforeAll(async ({ browser }) => {
  sql = openScratchDb();
  try {
    bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    adminId = await ensureBd(sql, e2eAdminEmail(), 'ZZ E2E Admin (no asignar)', 'admin');
    otherBdId = await ensureBd(sql, otherBdEmail, `ZZ E2E otro ${tag}`, 'bd');
    notePerson = await seedPerson('ZzNota');
    linkedinPerson = await seedPerson('ZzLinkedin', { profileKey });
    bareLinkedinPerson = await seedPerson('ZzSinLinkedin');
    rolePerson = await seedPerson('ZzRol', { jobTitle: 'Chief Technology Officer', roleGroup: 'c_level_tech' });

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
  // Activities cascade from the person; the audit trail of a deletion has no FK to it.
  await sql`delete from person where email like ${`zzrec-${tag}-%`}`;
  await sql`delete from bd where email = ${otherBdEmail}`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

test.describe('Contact record: deleting a note', () => {
  test('the author deletes their own note through the confirmation and the timeline keeps a tombstone', async ({ page }) => {
    const text = `Nota para borrar ${tag}`;
    const noteId = await seedNote(notePerson, bdId, text);
    await gotoAuthed(page, `/contacts/${notePerson}`);
    const card = page.locator('.tl-card', { hasText: text });
    await expect(card).toBeVisible();

    await card.getByLabel(L.noteMenuLabel).click();
    await card.getByRole('button', { name: L.noteDeleteAction, exact: true }).click();

    const dialog = page.getByRole('dialog', { name: L.noteDeleteDialogTitle });
    await expect(dialog).toBeVisible();
    // Cancelling keeps the note: the dialog alone never deletes.
    await dialog.getByRole('button', { name: L.noteDeleteCancel, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(text)).toBeVisible();
    const [kept] = await sql`select deleted_at from activity where id = ${noteId}`;
    expect(kept!.deleted_at).toBeNull();

    await card.getByLabel(L.noteMenuLabel).click();
    await card.getByRole('button', { name: L.noteDeleteAction, exact: true }).click();
    await page.getByRole('dialog', { name: L.noteDeleteDialogTitle }).getByRole('button', { name: L.noteDeleteAction, exact: true }).click();

    // The text is gone from the page and a tombstone says who wrote and who deleted it.
    const tombstone = page.locator('.tl-card.system', { hasText: L.noteDeletedTitle });
    await expect(tombstone).toBeVisible();
    await expect(tombstone).toContainText(L.noteDeletedWrittenBy);
    await expect(tombstone).toContainText(L.noteDeletedDeletedBy);
    await expect(tombstone).not.toContainText(L.noteDeletedAdminSuffix);
    await expect(page.getByText(text)).toHaveCount(0);

    const [row] = await sql`select deleted_at, deleted_by_bd_id from activity where id = ${noteId}`;
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by_bd_id).toBe(bdId);
  });

  test('a BD gets no delete menu on another BD\'s note', async ({ page }) => {
    const text = `Nota ajena ${tag}`;
    await seedNote(notePerson, otherBdId, text);
    await gotoAuthed(page, `/contacts/${notePerson}`);
    const card = page.locator('.tl-card', { hasText: text });
    await expect(card).toBeVisible();
    await expect(card.getByLabel(L.noteMenuLabel)).toHaveCount(0);
  });
});

test.describe('Contact record: an admin deleting a note', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('can delete another BD\'s note and the tombstone says an administrator did it', async ({ page }) => {
    const text = `Nota de otro, borra admin ${tag}`;
    const noteId = await seedNote(notePerson, otherBdId, text);
    await gotoAuthed(page, `/contacts/${notePerson}`);
    const card = page.locator('.tl-card', { hasText: text });
    await expect(card).toBeVisible();

    await card.getByLabel(L.noteMenuLabel).click();
    await card.getByRole('button', { name: L.noteDeleteAction, exact: true }).click();
    await page.getByRole('dialog', { name: L.noteDeleteDialogTitle }).getByRole('button', { name: L.noteDeleteAction, exact: true }).click();

    const tombstone = page.locator('.tl-card.system', { hasText: `${L.noteDeletedDeletedBy}` }).filter({ hasText: L.noteDeletedAdminSuffix });
    await expect(tombstone.first()).toBeVisible();
    await expect(page.getByText(text)).toHaveCount(0);

    const [row] = await sql`select deleted_at, deleted_by_bd_id from activity where id = ${noteId}`;
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by_bd_id).toBe(adminId);
  });
});

test.describe('Contact record: the LinkedIn link', () => {
  test('a contact with a profile shows a LinkedIn badge that opens it in a new tab', async ({ page }) => {
    await gotoAuthed(page, `/contacts/${linkedinPerson}`);
    const badge = page.locator('.record-identity').getByRole('link', { name: L.linkedInBadge, exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('href', `https://${profileKey}`);
    await expect(badge).toHaveAttribute('target', '_blank');
    await expect(badge).toHaveAttribute('rel', /noreferrer/);
  });

  test('a contact without a profile shows no LinkedIn badge', async ({ page }) => {
    await gotoAuthed(page, `/contacts/${bareLinkedinPerson}`);
    await expect(page.locator('.record-identity h1')).toContainText('ZzSinLinkedin');
    await expect(page.locator('.record-identity').getByRole('link', { name: L.linkedInBadge, exact: true })).toHaveCount(0);
  });
});

test.describe('Contact record: the role group stays hidden', () => {
  test('the record does not show a "Grupo de rol" row even for a classified contact', async ({ page }) => {
    await gotoAuthed(page, `/contacts/${rolePerson}`);
    await expect(page.locator('.record-identity h1')).toContainText('ZzRol');
    // The Cargo is there; the derived group next to it is not.
    await expect(page.locator('.record-left')).toContainText('Chief Technology Officer');
    await expect(page.locator('.record-left').getByText(es.common.roleGroupLabel, { exact: true })).toHaveCount(0);
    await expect(page.locator('.record-left').getByText(es.roleGroups.c_level_tech, { exact: true })).toHaveCount(0);
  });

  test('the list column picker does not offer it and the table has no such header', async ({ page }) => {
    await gotoAuthed(page, '/contacts?view=all');
    await page.locator('details.dropdown > summary', { hasText: es.contactList.columnsPickerLabel }).first().click();
    const menu = page.locator('form.menu', { has: page.locator('input[name="columns"]') });
    await expect(menu).toBeVisible();
    // Sanity: the picker does list real columns, so the absence below is meaningful.
    expect(await menu.locator('input[name="columns"]').count()).toBeGreaterThan(5);
    await expect(menu.getByText(es.common.roleGroupLabel)).toHaveCount(0);
    await expect(page.locator('table.data thead').getByText(es.common.roleGroupLabel)).toHaveCount(0);
  });
});
