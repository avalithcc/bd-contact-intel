import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { e2eBdEmail, ensureBd, ensureEmailAccount, openScratchDb, runTag, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.contactRecord;

skipWithoutCredentials();
// Schedules emails and seeds rows in the database: scratch only.
skipUnlessWritesAllowed();

/**
 * "Programar envío" from a contact's email composer (scheduled-send, shipped 2026-10-16; mockup
 * envio-programado.html views 1a and 1b).
 *
 * What is covered: the entry point from the composer, the scheduling dialog (Argentina time with Miami shown),
 * the 5 minute and 30 day limits, a successful schedule, and that scheduling is NOT a touch: the row is written
 * as `scheduled`, nothing is sent, no activity is logged and the contact's status does not move.
 *
 * What is NOT covered, and why: editing, cancelling and the 2 minute lock. The server actions exist
 * (editScheduledEmailAction, cancelScheduledEmailAction in src/app/(app)/contacts/scheduleActions.ts) and the SQL
 * is covered by tests/db, but no screen calls them yet: the contact timeline card and the "Programados" list of
 * mockup sections 2, 3 and 5 have not shipped, so a browser cannot reach them. The three `test.fixme` cases
 * below keep that visible and become real tests when the screens land. The dispatcher is never run here.
 *
 * Time arithmetic stays far from the limits (2 and 4 minutes vs 5; 6 and 7 minutes vs 5; 29 and 31 days vs 30),
 * so a slow machine cannot flip a verdict.
 */

const tag = runTag();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let sql: ScratchSql;
let bdId: string;
let accountId: string;
let accountCreated = false;
let withEmail: { id: string; name: string; email: string };
let withoutEmail: { id: string; name: string };

/** Argentina wall clock (UTC-3, no DST) of an instant, as the date and time inputs take it. */
function artInputs(ms: number): { date: string; time: string } {
  const iso = new Date(ms - 3 * 60 * MIN).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

async function seedPerson(first: string, email: string | null): Promise<{ id: string }> {
  const [p] = await sql`
    insert into person (first_name, last_name, email, email_normalized, company, company_key, job_title, owner_bd_id, status)
    values (${first}, 'Programado', ${email}, ${email}, 'Acme Pruebas', 'acme-pruebas', 'CTO', ${bdId}, 'new') returning id`;
  return { id: p!.id as string };
}

test.beforeAll(async () => {
  sql = openScratchDb();
  try {
    bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    const account = await ensureEmailAccount(sql, bdId, `sched-${tag}@example.com`);
    accountId = account.id;
    accountCreated = account.created;
    const email = `zzsched-${tag}@example.com`;
    withEmail = { ...(await seedPerson(`ZzSched${tag}`, email)), name: `ZzSched${tag} Programado`, email };
    withoutEmail = { ...(await seedPerson(`ZzSinMail${tag}`, null)), name: `ZzSinMail${tag} Programado` };
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

async function cleanup() {
  // scheduled_email, activity and the rest cascade from the person; the mailbox row only if this run created it.
  await sql`delete from person where email like ${`zzsched-${tag}@%`} or first_name like ${`ZzSinMail${tag}`}`;
  if (accountCreated) await sql`delete from email_account where id = ${accountId}`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

// Each test starts from a clean slate for the contact under test.
test.beforeEach(async () => {
  await sql`delete from scheduled_email where person_id = ${withEmail.id}`;
  await sql`update email_account set status = 'connected' where id = ${accountId}`;
});

async function openComposer(page: Page, personId: string) {
  await gotoAuthed(page, `/contacts/${personId}`);
  await page.locator('.quick-actions').getByRole('button', { name: L.quickActionEmail, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Composer -> "Programar…" with a typed draft; returns the scheduling dialog. */
async function openScheduleDialog(page: Page, subject = `Asunto ${tag}`, body = `Cuerpo del mensaje ${tag}.`) {
  const composer = await openComposer(page, withEmail.id);
  await composer.getByLabel(L.emailSubjectLabel).fill(subject);
  await composer.getByLabel(L.emailBodyLabel).fill(body);
  await composer.getByRole('button', { name: L.scheduleAction, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`${L.scheduleTitle} ${withEmail.name}`) });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setWhen(dialog: ReturnType<Page['getByRole']>, ms: number) {
  const { date, time } = artInputs(ms);
  await dialog.getByLabel(L.scheduleZone, { exact: true }).selectOption('argentina');
  await dialog.getByLabel(L.scheduleDate, { exact: true }).fill(date);
  await dialog.getByLabel(L.scheduleTime, { exact: true }).fill(time);
}

const submit = (dialog: ReturnType<Page['getByRole']>) => dialog.getByRole('button', { name: L.scheduleSubmit, exact: true });
const rowsFor = async (personId: string) =>
  sql`select id, status, subject, body, to_address, send_at, sent_at, gmail_message_id, error from scheduled_email where person_id = ${personId}`;

test.describe('Scheduled send: the composer entry point and the scheduling dialog', () => {
  test('the composer offers "Programar…" next to "Enviar" and hands its draft to the scheduling dialog', async ({ page }) => {
    const composer = await openComposer(page, withEmail.id);
    await expect(composer.getByRole('button', { name: L.scheduleAction, exact: true })).toBeVisible();
    await expect(composer.getByRole('button', { name: L.emailSend, exact: true })).toBeVisible();

    await composer.getByLabel(L.emailSubjectLabel).fill(`Asunto ${tag}`);
    await composer.getByLabel(L.emailBodyLabel).fill('Mensaje de prueba.');
    await composer.getByRole('button', { name: L.scheduleAction, exact: true }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(`${L.scheduleTitle} ${withEmail.name}`) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(L.emailSubjectLabel)).toHaveValue(`Asunto ${tag}`);
    await expect(dialog.getByLabel(L.emailBodyLabel)).toHaveValue('Mensaje de prueba.');
  });

  test('defaults to tomorrow 09:00 Argentina and says the time in both zones', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    const tomorrow = artInputs(Date.now() + DAY).date;
    await expect(dialog.getByLabel(L.scheduleDate, { exact: true })).toHaveValue(tomorrow);
    await expect(dialog.getByLabel(L.scheduleTime, { exact: true })).toHaveValue('09:00');
    await expect(dialog.getByLabel(L.scheduleZone, { exact: true })).toHaveValue('argentina');
    await expect(dialog.getByLabel(L.scheduleZone, { exact: true }).locator('option')).toHaveText([L.scheduleZoneArgentina, L.scheduleZoneMiami]);

    const summary = dialog.locator('.alert');
    await expect(summary).toContainText(L.scheduleWillSend);
    await expect(summary).toContainText(L.scheduleInArgentina);
    await expect(summary).toContainText(L.scheduleInMiami);
    // Buenos Aires is UTC-3 and Miami UTC-4 or UTC-5: the Miami clock is never also 09:00.
    await expect(summary.locator('strong')).toContainText('09:00');
    expect(await summary.innerText()).not.toMatch(new RegExp(`${L.scheduleInMiami}[^.]*09:00`));
    await expect(submit(dialog)).toBeEnabled();
  });

  test('picking Miami reads the same wall time in the other zone', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    const argentina = await dialog.locator('.alert strong').innerText();
    await dialog.getByLabel(L.scheduleZone, { exact: true }).selectOption('miami');
    await expect(dialog.locator('.alert strong')).not.toHaveText(argentina);
    await expect(dialog.locator('.alert')).toContainText(L.scheduleInMiami);
  });

  test('"En 1 hora" sets a time about an hour away and enables the button', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    await dialog.getByRole('button', { name: L.schedulePresetHour, exact: true }).click();
    const date = await dialog.getByLabel(L.scheduleDate, { exact: true }).inputValue();
    const time = await dialog.getByLabel(L.scheduleTime, { exact: true }).inputValue();
    const leadMin = (Date.parse(`${date}T${time}:00-03:00`) - Date.now()) / MIN; // the inputs are Argentina wall time
    expect(leadMin).toBeGreaterThan(57);
    expect(leadMin).toBeLessThan(62);
    await expect(submit(dialog)).toBeEnabled();
  });

  test('rejects less than 5 minutes ahead: hint shown, no summary, button disabled; 6 minutes is fine', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    await setWhen(dialog, Date.now() + 2 * MIN);
    await expect(dialog.getByText(L.scheduleTooSoonHint)).toBeVisible();
    await expect(dialog.locator('.alert')).toHaveCount(0);
    await expect(submit(dialog)).toBeDisabled();

    await setWhen(dialog, Date.now() - 30 * MIN); // the past is the same refusal
    await expect(dialog.getByText(L.scheduleTooSoonHint)).toBeVisible();
    await expect(submit(dialog)).toBeDisabled();

    await setWhen(dialog, Date.now() + 7 * MIN);
    await expect(dialog.getByText(L.scheduleTooSoonHint)).toHaveCount(0);
    await expect(submit(dialog)).toBeEnabled();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });

  test('rejects more than 30 days ahead: no summary and the button stays disabled; 29 days is fine', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    await setWhen(dialog, Date.now() + 31 * DAY);
    await expect(dialog.locator('.alert')).toHaveCount(0);
    await expect(submit(dialog)).toBeDisabled();

    await setWhen(dialog, Date.now() + 29 * DAY);
    await expect(dialog.locator('.alert')).toBeVisible();
    await expect(submit(dialog)).toBeEnabled();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });

  test('"Volver a Enviar" goes back to the composer with the draft intact; "Cancelar" closes without scheduling', async ({ page }) => {
    const dialog = await openScheduleDialog(page, `Volver ${tag}`, 'Texto que no se pierde.');
    await dialog.getByRole('button', { name: L.scheduleBack, exact: true }).click();
    const composer = page.getByRole('dialog', { name: L.quickActionEmail });
    await expect(composer.getByLabel(L.emailSubjectLabel)).toHaveValue(`Volver ${tag}`);
    await expect(composer.getByLabel(L.emailBodyLabel)).toHaveValue('Texto que no se pierde.');

    await composer.getByRole('button', { name: L.scheduleAction, exact: true }).click();
    await page.getByRole('dialog', { name: new RegExp(L.scheduleTitle) }).getByRole('button', { name: L.cancel, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });

  test('a contact without an email address has no way to schedule', async ({ page }) => {
    const dialog = await openComposer(page, withoutEmail.id);
    await expect(dialog.getByText(L.emailNoAddress)).toBeVisible();
    await expect(dialog.getByRole('button', { name: L.scheduleAction })).toHaveCount(0);
  });
});

test.describe('Scheduled send: scheduling writes one row and is not a touch', () => {
  test('schedules in an hour: toast, dialog closed, one `scheduled` row, nothing sent, no activity, status unchanged', async ({ page }) => {
    const [before] = await sql`
      select (select count(*)::int from activity where person_id = ${withEmail.id}) as activities,
             (select count(*)::int from email_message) as messages,
             (select status from person where id = ${withEmail.id}) as status`;

    const dialog = await openScheduleDialog(page, `Programado ${tag}`, 'Sale solo, más tarde.');
    await dialog.getByRole('button', { name: L.schedulePresetHour, exact: true }).click();
    await submit(dialog).click();

    await expect(page.locator('#toast-region')).toContainText(L.toastEmailScheduled);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const rows = await rowsFor(withEmail.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('scheduled');
    expect(row.subject).toBe(`Programado ${tag}`);
    expect(row.body).toBe('Sale solo, más tarde.');
    expect(row.to_address).toBe(withEmail.email);
    const leadMin = ((row.send_at as Date).getTime() - Date.now()) / MIN;
    expect(leadMin).toBeGreaterThan(55);
    expect(leadMin).toBeLessThan(62);
    // Nothing went out.
    expect(row.sent_at).toBeNull();
    expect(row.gmail_message_id).toBeNull();
    expect(row.error).toBeNull();

    const [after] = await sql`
      select (select count(*)::int from activity where person_id = ${withEmail.id}) as activities,
             (select count(*)::int from email_message) as messages,
             (select status from person where id = ${withEmail.id}) as status`;
    expect(after).toEqual(before);
    const [sent] = await sql`select count(*)::int as n from activity where person_id = ${withEmail.id} and type = 'email_sent'`;
    expect(sent!.n).toBe(0);
  });

  test('a time typed by hand is stored as the exact instant, read in the chosen zone', async ({ page }) => {
    const dialog = await openScheduleDialog(page);
    // 10:00 Miami, three days out. Miami is UTC-4 or UTC-5, so the instant must be 14:00 or 15:00 UTC, never 13:00.
    const day = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    await dialog.getByLabel(L.scheduleZone, { exact: true }).selectOption('miami');
    await dialog.getByLabel(L.scheduleDate, { exact: true }).fill(day);
    await dialog.getByLabel(L.scheduleTime, { exact: true }).fill('10:00');
    await submit(dialog).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastEmailScheduled);

    const [row] = await rowsFor(withEmail.id);
    const utcHour = (row!.send_at as Date).getUTCHours();
    expect([14, 15]).toContain(utcHour);
    expect((row!.send_at as Date).getUTCMinutes()).toBe(0);
  });

  test('with the Gmail account disconnected nothing is scheduled: the error stays in the dialog, which stays open', async ({ page }) => {
    await sql`update email_account set status = 'revoked' where id = ${accountId}`;
    const dialog = await openScheduleDialog(page);
    await submit(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText(L.errorGmailNotConnected.split('.')[0]!);
    await expect(dialog).toBeVisible();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });
});

test.describe('Scheduled send: edit, cancel and the 2 minute lock', () => {
  const REASON =
    'No screen reaches editScheduledEmailAction / cancelScheduledEmailAction yet: the contact timeline card and the ' +
    '"Programados" list (envio-programado.html sections 2, 3, 5) have not shipped. Turn this into a real test with the screen.';

  test.fixme('a scheduled email can be edited from the contact timeline card', { annotation: { type: 'blocked', description: REASON } }, async () => {});

  test.fixme('a scheduled email can be cancelled and leaves a system line in the timeline', { annotation: { type: 'blocked', description: REASON } }, async () => {});

  test.fixme('within 2 minutes of the send time edit and cancel are locked (row seeded with send_at in ~1 minute)', { annotation: { type: 'blocked', description: REASON } }, async () => {});
});
