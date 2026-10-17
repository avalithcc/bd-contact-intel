import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import {
  ADMIN_STORAGE_STATE,
  e2eAdminEmail,
  e2eBdEmail,
  ensureBd,
  ensureEmailAccount,
  openScratchDb,
  runTag,
  saveLoginState,
  type ScratchSql,
} from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';
import { fill } from '../../src/lib/sequences/viewText';

const L = es.sequences;

skipWithoutCredentials();
// Seeds a second BD's Sequences straight into the database: scratch only.
skipUnlessWritesAllowed();

/**
 * Sequences visibility (outreach-sequences + sequences-admin-read, shipped 2026-10-16).
 *
 * Two real accounts: the shared `chromium` session is the BD (`E2E_EMAIL`, role `bd`), and a second login
 * (`admin-e2e@avalith.net`, created by scripts/create-e2e-auth-user.ts, role `admin` in the `bd` table) is
 * used by the admin tests through `test.use({ storageState })`. Each owns one Sequence with three members: a
 * draft to review, an approved email waiting to go out and a contact who replied. Nothing here sends mail:
 * the specs only read pages and open dialogs, and they never press an approve button.
 *
 * Everything seeded carries a per-run tag and is removed in afterAll.
 */

const tag = runTag();
const BD_SEQ = `ZZ Seq BD ${tag}`;
const ADMIN_SEQ = `ZZ Seq Admin ${tag}`;

let sql: ScratchSql;
let bdId: string;
let adminId: string;
let bdName: string;
let adminName: string;
let bdSeqId: string;
let adminSeqId: string;
const createdAccounts: string[] = [];

/** Member names: first name carries the owner and the tag so a card is found by who it belongs to. */
const draftName = (who: 'Bd' | 'Adm') => `Zz${who}${tag}Borrador Revisar`;
const approvedName = (who: 'Bd' | 'Adm') => `Zz${who}${tag}Aprobado Cola`;
const repliedName = (who: 'Bd' | 'Adm') => `Zz${who}${tag}Respondio Tema`;

async function seedSequence(ownerId: string, accountId: string, name: string, who: 'Bd' | 'Adm'): Promise<string> {
  const [seq] = await sql`
    insert into sequence (name, owner_bd_id, email_account_id, daily_send_cap, schedule)
    values (${name}, ${ownerId}, ${accountId}, 5, ${sql.json({ step1: { hour: 9, timezone: 'America/New_York', offsetDays: 1 }, step2: { afterDays: 7 } })})
    returning id`;
  const person = async (full: string, n: number) => {
    const [first, ...rest] = full.split(' ');
    const mail = `zzseq-${tag}-${who.toLowerCase()}${n}@example.com`;
    const [p] = await sql`
      insert into person (first_name, last_name, email, email_normalized, company, company_key, job_title, owner_bd_id, status)
      values (${first!}, ${rest.join(' ')}, ${mail}, ${mail}, 'Acme Pruebas', 'acme-pruebas', 'CTO', ${ownerId}, 'new') returning id`;
    return p!.id as string;
  };

  const drafted = await person(draftName(who), 1);
  const [m1] = await sql`insert into sequence_member (sequence_id, person_id, state) values (${seq!.id}, ${drafted}, 'drafted') returning id`;
  await sql`insert into sequence_draft (sequence_member_id, step, subject, body) values (${m1!.id}, 1, ${`Asunto ${who} ${tag}`}, ${`Hola, cuerpo del borrador de ${who} ${tag}.`})`;

  const approved = await person(approvedName(who), 2);
  const [m2] = await sql`insert into sequence_member (sequence_id, person_id, state) values (${seq!.id}, ${approved}, 'approved') returning id`;
  await sql`
    insert into sequence_draft (sequence_member_id, step, subject, body, approved_at, approved_by_bd_id, scheduled_for)
    values (${m2!.id}, 1, ${`Aprobado ${who} ${tag}`}, 'Cuerpo aprobado.', now(), ${ownerId}, now() + interval '2 days')`;

  const replied = await person(repliedName(who), 3);
  await sql`
    insert into sequence_member (sequence_id, person_id, state, sent_at, replied_at)
    values (${seq!.id}, ${replied}, 'replied', now() - interval '3 days', now() - interval '1 day')`;
  return seq!.id as string;
}

async function cleanup() {
  // Members and drafts go with their Sequence; persons have no cascade, so they go after.
  await sql`delete from sequence where name like ${`ZZ Seq % ${tag}`}`;
  await sql`delete from person where email like ${`zzseq-${tag}-%`}`;
  for (const id of createdAccounts) await sql`delete from email_account where id = ${id}`;
}

test.beforeAll(async ({ browser }) => {
  sql = openScratchDb();
  try {
    bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    adminId = await ensureBd(sql, e2eAdminEmail(), 'ZZ E2E Admin (no asignar)', 'admin');
    // A row that already existed keeps its own name; the assertions use whatever the database says.
    const names = await sql`select id, name from bd where id in (${bdId}, ${adminId})`;
    bdName = names.find((r) => r.id === bdId)!.name as string;
    adminName = names.find((r) => r.id === adminId)!.name as string;

    for (const id of [bdId, adminId]) {
      const account = await ensureEmailAccount(sql, id, `seq-${tag}-${id.slice(0, 4)}@example.com`);
      if (account.created) createdAccounts.push(account.id);
    }
    const [bdAccount] = await sql`select id from email_account where bd_id = ${bdId}`;
    const [adminAccount] = await sql`select id from email_account where bd_id = ${adminId}`;
    bdSeqId = await seedSequence(bdId, bdAccount!.id as string, BD_SEQ, 'Bd');
    adminSeqId = await seedSequence(adminId, adminAccount!.id as string, ADMIN_SEQ, 'Adm');

    const baseURL = test.info().project.use.baseURL;
    if (!baseURL) throw new Error('baseURL is not configured');
    await saveLoginState(browser, baseURL, e2eAdminEmail(), ADMIN_STORAGE_STATE);
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

const rowOf = (page: Page, name: string) => page.locator('tbody tr', { has: page.getByRole('link', { name, exact: true }) });
const card = (page: Page, personName: string) => page.locator('.card', { has: page.getByRole('link', { name: personName, exact: true }) }).last();
const statLabels = (page: Page) => page.locator('.grid-4 .stat .label');

/** Every control that writes, by the name it carries. Used both ways: absent for a reader, present for the owner. */
const WRITE_BUTTONS = [L.editSequence, L.approveReadyOne, L.actions.reviewDraft, L.actions.approve, L.actions.cancel, L.actions.generate, L.actions.advanceReminder];

test.describe('Sequences: a BD sees only their own', () => {
  test('the list shows the BD\'s Sequence, with no tabs and no Responsable column or filter', async ({ page }) => {
    await gotoAuthed(page, '/sequences');
    await expect(rowOf(page, BD_SEQ)).toBeVisible();
    await expect(page.getByRole('link', { name: ADMIN_SEQ, exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: L.listTabsLabel })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: L.listColOwner })).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.listColOwner })).toHaveCount(0);
  });

  for (const query of ['?scope=all', '?scope=all&owner=ADMIN', '?owner=ADMIN']) {
    test(`asking for ${query} in the URL does not reveal another BD's Sequences`, async ({ page }) => {
      await gotoAuthed(page, `/sequences${query.replace('ADMIN', adminId)}`);
      await expect(rowOf(page, BD_SEQ)).toBeVisible();
      await expect(page.getByText(ADMIN_SEQ)).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: L.listTabsLabel })).toHaveCount(0);
      await expect(page.getByRole('columnheader', { name: L.listColOwner })).toHaveCount(0);
    });
  }

  test('another BD\'s Sequence by direct URL is a 404 that names nothing', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${adminSeqId}`);
    await expect(page.getByRole('heading', { name: es.notFoundPage.title })).toBeVisible();
    await expect(page.getByText(ADMIN_SEQ)).toHaveCount(0);
    await expect(page.getByText(draftName('Adm'))).toHaveCount(0);
  });

  test('the BD\'s own Sequence opens with write controls and no read-only banner', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${bdSeqId}`);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(BD_SEQ) })).toBeVisible();
    await expect(page.getByRole('note').filter({ hasText: es.sequences.readOnlyBody })).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.editSequence, exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: fill(L.selectMember, { name: draftName('Bd') }) })).toBeVisible();
  });
});

test.describe('Sequences: the admin list', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('tabs Mías / Todas with the right counts; Mías is the default and shows only the admin\'s own', async ({ page }) => {
    const [mine] = await sql`select count(*)::int as n from sequence where owner_bd_id = ${adminId}`;
    const [all] = await sql`select count(*)::int as n from sequence`;
    await gotoAuthed(page, '/sequences');
    const tabs = page.getByRole('navigation', { name: L.listTabsLabel });
    const mineTab = tabs.getByRole('link', { name: new RegExp(`^${L.listTabMine}`) });
    const allTab = tabs.getByRole('link', { name: new RegExp(`^${L.listTabAll}`) });
    await expect(mineTab).toHaveAttribute('aria-current', 'page');
    await expect(allTab).not.toHaveAttribute('aria-current', 'page');
    await expect(mineTab.locator('.count')).toHaveText(String(mine!.n));
    await expect(allTab.locator('.count')).toHaveText(String(all!.n));
    await expect(rowOf(page, ADMIN_SEQ)).toBeVisible();
    await expect(page.getByRole('link', { name: BD_SEQ, exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: L.listColOwner })).toBeVisible();
    // Mías keeps all four stat cards.
    await expect(statLabels(page)).toHaveText([L.listStatSequences, L.statReview, L.statQueued, L.statReplied]);
  });

  test('Todas lists every BD, shows the Responsable column and hides the two non-actionable cards', async ({ page }) => {
    await gotoAuthed(page, '/sequences');
    await page.getByRole('navigation', { name: L.listTabsLabel }).getByRole('link', { name: new RegExp(`^${L.listTabAll}`) }).click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(rowOf(page, ADMIN_SEQ)).toBeVisible();
    await expect(rowOf(page, BD_SEQ)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: L.listColOwner })).toBeVisible();
    await expect(rowOf(page, BD_SEQ).locator('.owner-chip')).toContainText(bdName);
    // Mine carries the "(yo)" marker, another BD's does not.
    await expect(rowOf(page, ADMIN_SEQ)).toContainText(L.listOwnerMe);
    await expect(rowOf(page, BD_SEQ)).not.toContainText(L.listOwnerMe);
    await expect(statLabels(page)).toHaveText([L.listStatSequences, L.statReplied]);
    await expect(page.getByText(L.statReview, { exact: true })).toHaveCount(0);
    await expect(page.getByText(L.statQueued, { exact: true })).toHaveCount(0);
    await expect(page.getByText(L.listAllNote)).toBeVisible();
  });

  test('the Responsable chip filters Todas to one BD, and "Quitar filtro" / "Borrar todo" undo it', async ({ page }) => {
    await gotoAuthed(page, '/sequences?scope=all');
    await page.getByRole('button', { name: L.listColOwner, exact: true }).click();
    await expect(page.getByText(L.listOwnerFilterLabel)).toBeVisible();
    await page.getByRole('menuitem', { name: new RegExp(bdName.replace(/[()]/g, '\\$&')) }).click();
    await expect(page).toHaveURL(new RegExp(`owner=${bdId}`));
    await expect(rowOf(page, BD_SEQ)).toBeVisible();
    await expect(page.getByRole('link', { name: ADMIN_SEQ, exact: true })).toHaveCount(0);
    await expect(page.locator('.toolbar .chip')).toContainText(bdName);
    await expect(page.getByText(fill(L.listOwnerNote, { name: bdName }))).toBeVisible();

    // The filter is removed from the chip itself ...
    await page.getByRole('button', { name: L.listRemoveFilter }).click();
    await expect(page).not.toHaveURL(/owner=/);
    await expect(rowOf(page, ADMIN_SEQ)).toBeVisible();
    await expect(rowOf(page, BD_SEQ)).toBeVisible();

    // ... and by "Borrar todo".
    await gotoAuthed(page, `/sequences?scope=all&owner=${bdId}`);
    await expect(page.getByRole('link', { name: ADMIN_SEQ, exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: L.listClearAll }).click();
    await expect(page).not.toHaveURL(/owner=/);
    await expect(rowOf(page, ADMIN_SEQ)).toBeVisible();
  });
});

test.describe('Sequences: an admin opening another BD\'s Sequence reads it only', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('shows the "Solo lectura" banner and not one write control, and writes no audit row', async ({ page }) => {
    const [before] = await sql`select count(*)::int as n from audit_log where action = 'view_sequence'`;
    await gotoAuthed(page, `/sequences/${bdSeqId}`);

    const banner = page.getByRole('note').filter({ hasText: fill(L.readOnlyTitle, { owner: bdName }) });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(L.readOnlyBody);
    await expect(page.getByRole('link', { name: L.readOnlyBack })).toBeVisible();

    for (const name of WRITE_BUTTONS) await expect(page.getByRole('button', { name }), name).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(`^${L.approveReady.replace('{n}', '\\d+')}$`) })).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.cadenceChange, exact: true })).toHaveCount(0);
    // No selection column and therefore no bulk bar.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.locator('.bulk-bar')).toHaveCount(0);

    // What a reader may do: read the draft, the queued email, and open the conversation.
    await expect(card(page, draftName('Bd')).getByRole('button', { name: L.actions.viewDraft, exact: true })).toBeVisible();
    await expect(card(page, approvedName('Bd')).getByRole('button', { name: L.actions.viewEmail, exact: true })).toBeVisible();
    await expect(card(page, repliedName('Bd')).getByRole('link', { name: L.actions.openConversation, exact: true })).toBeVisible();

    const [after] = await sql`select count(*)::int as n from audit_log where action = 'view_sequence'`;
    expect(after!.n).toBe(before!.n);
  });

  test('the overflow menu of a card offers only "Abrir ficha": no remove, regenerate or opt-out', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${bdSeqId}`);
    for (const person of [draftName('Bd'), repliedName('Bd')]) {
      await card(page, person).getByRole('button', { name: L.moreActions }).click();
      await expect(page.getByRole('menuitem')).toHaveText([L.actions.openContact]);
      await expect(page.getByRole('menuitem', { name: L.actions.remove })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: L.actions.regenerate })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: L.actions.optOut })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });

  test('the review dialog is read-only: the notice replaces the editor and the only action is "Cerrar"', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${bdSeqId}`);
    await card(page, draftName('Bd')).getByRole('button', { name: L.actions.viewDraft, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(fill(L.readOnlyDialogNotice, { owner: bdName }));
    await expect(dialog.getByLabel(L.reviewSubject)).toHaveValue(`Asunto Bd ${tag}`);
    await expect(dialog.getByLabel(L.reviewSubject)).toHaveJSProperty('readOnly', true);
    await expect(dialog.getByLabel(L.reviewBody)).toHaveJSProperty('readOnly', true);

    const footer = dialog.locator('.dialog-footer').getByRole('button');
    await expect(footer).toHaveText([L.reviewClose]);
    for (const name of [L.reviewApprove, L.reviewSave, L.reviewRegenerate]) {
      await expect(dialog.getByRole('button', { name }), name).toHaveCount(0);
    }

    await footer.click();
    await expect(dialog).toHaveCount(0);
  });

  test('the queued email of the other BD also opens read-only', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${bdSeqId}`);
    await card(page, approvedName('Bd')).getByRole('button', { name: L.actions.viewEmail, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.dialog-footer').getByRole('button')).toHaveText([L.reviewClose]);
    await expect(dialog.getByLabel(L.reviewBody)).toHaveJSProperty('readOnly', true);
  });
});

test.describe('Sequences: the admin\'s own Sequence keeps its write controls', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('header, cards, checkboxes and the overflow menu are all there; no banner', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${adminSeqId}`);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(ADMIN_SEQ) })).toBeVisible();
    await expect(page.getByRole('note').filter({ hasText: L.readOnlyBody })).toHaveCount(0);

    await expect(page.getByRole('button', { name: L.editSequence, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: L.approveReadyOne, exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: L.cadenceChange, exact: true })).toBeVisible();

    const draft = card(page, draftName('Adm'));
    await expect(draft.getByRole('button', { name: L.actions.reviewDraft, exact: true })).toBeVisible();
    await expect(draft.getByRole('button', { name: L.actions.approve, exact: true })).toBeVisible();
    await expect(card(page, approvedName('Adm')).getByRole('button', { name: L.actions.cancel, exact: true })).toBeVisible();

    // Selecting a draft raises the bulk bar.
    const box = page.getByRole('checkbox', { name: fill(L.selectMember, { name: draftName('Adm') }) });
    await expect(page.locator('.bulk-bar')).toHaveCount(0);
    await box.check();
    await expect(page.locator('.bulk-bar')).toBeVisible();
    await box.uncheck();
    await expect(page.locator('.bulk-bar')).toHaveCount(0);

    await draft.getByRole('button', { name: L.moreActions }).click();
    await expect(page.getByRole('menuitem')).toHaveText([L.actions.regenerate, L.actions.openContact, L.actions.remove]);
    await page.keyboard.press('Escape');
    await card(page, repliedName('Adm')).getByRole('button', { name: L.moreActions }).click();
    await expect(page.getByRole('menuitem')).toHaveText([L.actions.optOut, L.actions.openContact]);
  });

  test('the review dialog of an own draft can be edited, saved, approved or regenerated', async ({ page }) => {
    await gotoAuthed(page, `/sequences/${adminSeqId}`);
    await card(page, draftName('Adm')).getByRole('button', { name: L.actions.reviewDraft, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(L.reviewSubject)).toHaveJSProperty('readOnly', false);
    await expect(dialog.locator('.dialog-footer').getByRole('button')).toHaveText([L.reviewRegenerate, L.reviewSave, L.reviewApprove]);
    await expect(dialog.getByRole('button', { name: L.reviewClose, exact: true })).toHaveCount(1); // only the corner "×"
    await dialog.getByRole('button', { name: L.reviewClose, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});
