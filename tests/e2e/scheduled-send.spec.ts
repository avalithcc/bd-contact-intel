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
 * Slice 2 (mockup sections 2, 3, 4, 5): the timeline card on the contact record (edit, change time, send now, cancel with its
 * system line, the 2 minute lock), the on-hold and dead-token cards, the "Programados" screen (sidebar pill, banner, table,
 * row menus, edit, cancel, only the caller's rows) and the "ya tenés uno" notice. Rows are seeded straight into the scratch
 * database. The dispatcher is never run here and the composer's "Enviar ahora" is not clicked (it would call Gmail);
 * the actions that make a row due ("Enviar ahora" on a card, "Enviar igual") only change the row.
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
let otherBdId: string;
const otherBdEmail = `zz-sched-other-${tag}@example.test`;
const HOUR = 60 * MIN;

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
    otherBdId = await ensureBd(sql, otherBdEmail, `ZZ E2E otro ${tag}`, 'bd');
  } catch (err) {
    await cleanup().catch(() => undefined);
    await sql.end();
    throw err;
  }
});

async function cleanup() {
  // scheduled_email, activity and the rest cascade from the person; the mailbox row only if this run created it.
  await sql`delete from email_message where gmail_message_id like ${`zzsched-${tag}-%`}`;
  await sql`delete from person where email like ${`zzsched-${tag}@%`} or first_name like ${`ZzSinMail${tag}`}`;
  if (accountCreated) await sql`delete from email_account where id = ${accountId}`;
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

// Each test starts from a clean slate for the contact under test.
test.beforeEach(async () => {
  await sql`delete from scheduled_email where bd_id = ${bdId}`; // the e2e BD is dedicated: the sidebar pill counts all its rows
  await sql`update email_account set status = 'connected' where id = ${accountId}`;
});

async function openComposer(page: Page, personId: string) {
  await gotoAuthed(page, `/contacts/${personId}`);
  await page.locator('.quick-actions').getByRole('button', { name: L.quickActionEmail, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setWhen(dialog: ReturnType<Page['getByRole']>, ms: number) {
  const { date, time } = artInputs(ms);
  await dialog.getByLabel(L.scheduleZone, { exact: true }).selectOption('argentina');
  await dialog.getByLabel(L.scheduleDate, { exact: true }).fill(date);
  await dialog.getByLabel(L.scheduleTime, { exact: true }).fill(time);
}

const S = es.sendControl;

/** Composer -> chevron -> "Programar…" with a typed draft; returns the schedule popover (it lives inside the composer dialog). */
async function openSchedulePopover(page: Page, subject = `Asunto ${tag}`, body = `Cuerpo del mensaje ${tag}.`) {
  const composer = await openComposer(page, withEmail.id);
  await composer.getByLabel(L.emailSubjectLabel).fill(subject);
  await composer.getByLabel(L.emailBodyLabel).fill(body);
  await composer.getByRole('button', { name: S.moreOptions, exact: true }).click();
  await composer.getByRole('menuitem', { name: new RegExp(S.scheduleItem) }).click();
  const pop = composer.getByRole('dialog', { name: S.popTitleEmail });
  await expect(pop).toBeVisible();
  return pop;
}

/** Picks the Argentina day on the calendar (paging months if needed) and types the time. */
async function setPopoverWhen(pop: ReturnType<Page['getByRole']>, ms: number) {
  const { date, time } = artInputs(ms);
  const day = pop.locator(`[data-day="${date}"]`);
  for (let i = 0; i < 2 && (await day.count()) === 0; i++) await pop.getByRole('button', { name: S.calNext, exact: true }).click();
  await day.click();
  await pop.getByLabel(S.timeLabel, { exact: true }).fill(time);
}

const popSubmit = (pop: ReturnType<Page['getByRole']>) => pop.getByRole('button', { name: S.submitEmail, exact: true });
const rowsFor = async (personId: string) =>
  sql`select id, status, subject, body, to_address, send_at, sent_at, gmail_message_id, error from scheduled_email where person_id = ${personId}`;

test.describe('Scheduled send: the composer split button and the schedule popover', () => {
  test('the composer offers "Enviar ahora" with a chevron menu whose "Programar…" opens the popover and keeps the draft', async ({ page }) => {
    const composer = await openComposer(page, withEmail.id);
    await expect(composer.getByRole('button', { name: S.sendNow, exact: true })).toBeVisible();
    await composer.getByLabel(L.emailSubjectLabel).fill(`Asunto ${tag}`);
    await composer.getByLabel(L.emailBodyLabel).fill('Mensaje de prueba.');
    await composer.getByRole('button', { name: S.moreOptions, exact: true }).click();
    await expect(composer.getByRole('menu')).toBeVisible();
    await composer.getByRole('menuitem', { name: new RegExp(S.scheduleItem) }).click();
    await expect(composer.getByRole('dialog', { name: S.popTitleEmail })).toBeVisible();
    // No second dialog: the draft never leaves the composer.
    await expect(composer.getByLabel(L.emailSubjectLabel)).toHaveValue(`Asunto ${tag}`);
    await expect(composer.getByLabel(L.emailBodyLabel)).toHaveValue('Mensaje de prueba.');
  });

  test('the calendar fits seven columns and the time-zone reference renders', async ({ page }, testInfo) => {
    const pop = await openSchedulePopover(page);
    const cal = pop.locator('.cal');
    await expect(cal).toHaveCount(1);
    const [box, lastColumn] = await Promise.all([cal.boundingBox(), cal.locator('.dow').nth(6).boundingBox()]);
    if (!box || !lastColumn) throw new Error('calendar not rendered');
    expect(lastColumn.x + lastColumn.width, 'the 7th column must fit inside the calendar').toBeLessThanOrEqual(box.x + box.width + 1);
    // Day buttons reset the global button padding: a two-digit day is not squeezed into a smaller cell.
    const cell = await pop.locator('.day').nth(10).boundingBox();
    expect(cell!.width).toBeGreaterThan(box.width / 7 - 2);

    const tz = pop.getByLabel(S.refLabel);
    await expect(tz).toBeVisible();
    await expect(tz.locator('.tz-row.base')).toContainText(S.rowArgentina);
    for (const city of [S.rowNewYork, S.rowMadrid, S.rowBogota, S.rowSaoPaulo]) await expect(tz).toContainText(city);
    await page.screenshot({ path: testInfo.outputPath('schedule-popover.png') });
  });

  test('defaults to tomorrow 9:00 Argentina and words the summary in Argentina time', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    const tomorrow = artInputs(Date.now() + DAY).date;
    await expect(pop.getByLabel(S.timeLabel, { exact: true })).toHaveValue('09:00');
    await expect(pop.locator(`[data-day="${tomorrow}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(pop.locator('.sched-sum').first()).toContainText('a las 9:00');
    await expect(pop.locator('.sched-sum').first()).toContainText('hora de Argentina');
    await expect(popSubmit(pop)).toBeEnabled();
  });

  test('"En 1 hora" lands about an hour away and enables the button', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    await pop.getByRole('button', { name: S.presetHour, exact: true }).click();
    const time = await pop.getByLabel(S.timeLabel, { exact: true }).inputValue();
    const day = await pop.locator('.day[aria-pressed="true"]').getAttribute('data-day');
    const leadMin = (Date.parse(`${day}T${time}:00-03:00`) - Date.now()) / MIN;
    expect(leadMin).toBeGreaterThan(57);
    expect(leadMin).toBeLessThan(77);
    await expect(popSubmit(pop)).toBeEnabled();
  });

  test('rejects less than 5 minutes ahead and the past; 7 minutes is fine', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    await setPopoverWhen(pop, Date.now() + 2 * MIN);
    await expect(pop.getByText(S.tooSoon)).toBeVisible();
    await expect(popSubmit(pop)).toBeDisabled();
    await setPopoverWhen(pop, Date.now() + 7 * MIN);
    await expect(pop.getByText(S.tooSoon)).toHaveCount(0);
    await expect(popSubmit(pop)).toBeEnabled();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });

  test('days beyond 30 are disabled on the calendar; 29 days ahead is fine', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    const far = artInputs(Date.now() + 33 * DAY).date;
    await pop.getByRole('button', { name: S.calNext, exact: true }).click();
    await pop.getByRole('button', { name: S.calNext, exact: true }).click().catch(() => undefined);
    const farDay = pop.locator(`[data-day="${far}"]`);
    if (await farDay.count()) await expect(farDay).toHaveAttribute('aria-disabled', 'true');
    await setPopoverWhen(pop, Date.now() + 29 * DAY);
    await expect(popSubmit(pop)).toBeEnabled();
  });

  test('offers the three shortcuts; "Lunes 9:00" lands on a Monday and is shown pressed', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    for (const label of [S.presetHour, S.presetTomorrow, S.presetMonday]) await expect(pop.getByRole('button', { name: label, exact: true })).toBeVisible();
    const monday = pop.getByRole('button', { name: S.presetMonday, exact: true });
    await monday.click();
    await expect(monday).toHaveAttribute('aria-pressed', 'true');
    const day = await pop.locator('.day[aria-pressed="true"]').getAttribute('data-day');
    expect(new Date(`${day}T12:00:00Z`).getUTCDay()).toBe(1);
    await pop.getByLabel(S.timeLabel, { exact: true }).fill('12:34');
    await expect(monday).toHaveAttribute('aria-pressed', 'false');
  });

  test('Escape closes only the popover; "Cancelar" too; the composer and its draft stay', async ({ page }) => {
    const pop = await openSchedulePopover(page, `Volver ${tag}`, 'Texto que no se pierde.');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    const composer = page.getByRole('dialog', { name: L.quickActionEmail });
    await expect(composer.getByLabel(L.emailSubjectLabel)).toHaveValue(`Volver ${tag}`);
    await composer.getByRole('button', { name: S.moreOptions, exact: true }).click();
    await composer.getByRole('menuitem', { name: new RegExp(S.scheduleItem) }).click();
    await composer.getByRole('dialog', { name: S.popTitleEmail }).getByRole('button', { name: S.cancel, exact: true }).click();
    await expect(composer).toBeVisible();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });

  test('a contact without an email address has no way to send or schedule', async ({ page }) => {
    const dialog = await openComposer(page, withoutEmail.id);
    await expect(dialog.getByText(L.emailNoAddress)).toBeVisible();
    await expect(dialog.getByRole('button', { name: S.moreOptions })).toHaveCount(0);
  });
});

test.describe('Scheduled send: scheduling writes one row and is not a touch', () => {
  test('schedules in an hour: toast, dialog closed, one `scheduled` row, nothing sent, no activity, status unchanged', async ({ page }) => {
    const [before] = await sql`
      select (select count(*)::int from activity where person_id = ${withEmail.id}) as activities,
             (select count(*)::int from email_message) as messages,
             (select status from person where id = ${withEmail.id}) as status`;

    const pop = await openSchedulePopover(page, `Programado ${tag}`, 'Sale solo, más tarde.');
    await pop.getByRole('button', { name: S.presetHour, exact: true }).click();
    await popSubmit(pop).click();

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
    expect(leadMin).toBeLessThan(77); // the shortcut rounds up to the next quarter hour
    expect(row.sent_at).toBeNull();
    expect(row.gmail_message_id).toBeNull();
    expect(row.error).toBeNull();

    const [after] = await sql`
      select (select count(*)::int from activity where person_id = ${withEmail.id}) as activities,
             (select count(*)::int from email_message) as messages,
             (select status from person where id = ${withEmail.id}) as status`;
    expect(after).toEqual(before);
  });

  test('a time typed by hand is stored as the exact instant, read as Argentina time', async ({ page }) => {
    const pop = await openSchedulePopover(page);
    // 10:00 Argentina (UTC-3, no DST) is always 13:00 UTC.
    const day = artInputs(Date.now() + 3 * DAY).date;
    await pop.locator(`[data-day="${day}"]`).click();
    await pop.getByLabel(S.timeLabel, { exact: true }).fill('10:00');
    await popSubmit(pop).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastEmailScheduled);

    const [row] = await rowsFor(withEmail.id);
    expect((row!.send_at as Date).toISOString()).toBe(`${day}T13:00:00.000Z`);
  });

  test('with the Gmail account disconnected nothing is scheduled: the error shows and the popover stays open', async ({ page }) => {
    await sql`update email_account set status = 'revoked' where id = ${accountId}`;
    const pop = await openSchedulePopover(page);
    await popSubmit(pop).click();
    await expect(pop.getByRole('alert')).toContainText(L.errorGmailNotConnected.split('.')[0]!);
    await expect(pop).toBeVisible();
    expect(await rowsFor(withEmail.id)).toHaveLength(0);
  });
});

async function seedScheduled(
  personId: string,
  o: { inMs: number; subject: string; status?: string; error?: string | null; body?: string; owner?: string; to?: string },
): Promise<string> {
  const [r] = await sql`
    insert into scheduled_email (bd_id, person_id, to_address, subject, body, send_at, status, error, reply_baseline_at)
    values (${o.owner ?? bdId}, ${personId}, ${o.to ?? withEmail.email}, ${o.subject}, ${o.body ?? 'Texto programado.'}, ${new Date(Date.now() + o.inMs)},
            ${o.status ?? 'scheduled'}, ${o.error ?? null}, ${new Date(Date.now() - 2 * HOUR)})
    returning id`;
  return r!.id as string;
}
const rowOf = async (id: string) => (await sql`select status, subject, body, send_at, error, reply_baseline_at from scheduled_email where id = ${id}`)[0]!;
const timelineCard = (page: Page, subject: string) => page.locator('#scheduled-emails .tl-card').filter({ hasText: subject });

test.describe('Scheduled send: the contact timeline card (edit, cancel, lock)', () => {
  test('a scheduled email shows as a card in "Próximas" with both zones and the four actions', async ({ page }) => {
    await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Card ${tag}`, body: 'Hola, un mensaje largo de prueba.' });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Card ${tag}`);
    await expect(page.locator('#scheduled-emails .tl-group')).toHaveText(es.contactRecord.timelineGroupUpcoming);
    await expect(card.locator('.what')).toHaveText(`${L.schedCardTitle} · Card ${tag}`);
    await expect(card.locator('.badge')).toContainText(L.schedCardSends);
    await expect(card.locator('.when')).toContainText(`${L.schedCardBy} ZZ E2E (no asignar)`);
    await expect(card.locator('.tl-body')).toContainText(`${L.schedCardTo} ${withEmail.email}`);
    await expect(card.locator('.tl-body')).toContainText(L.schedCardInMiami);
    for (const label of [L.schedActionEdit, L.schedActionChangeTime, L.schedActionSendNow, L.schedActionCancel]) {
      await expect(card.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test('"Editar" reopens the scheduling dialog loaded with the row; saving updates it in place', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Antes ${tag}`, body: 'Texto original.' });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    await timelineCard(page, `Antes ${tag}`).getByRole('button', { name: L.schedActionEdit, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`${L.scheduleEditTitle} ${withEmail.name}`) });
    await expect(dialog.getByLabel(L.emailSubjectLabel)).toHaveValue(`Antes ${tag}`);
    await expect(dialog.getByLabel(L.emailBodyLabel)).toHaveValue('Texto original.');
    await expect(dialog.getByRole('button', { name: L.scheduleBack })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: L.scheduleSendNow })).toHaveCount(0);

    await dialog.getByLabel(L.emailSubjectLabel).fill(`Despues ${tag}`);
    const newTime = Date.now() + 5 * HOUR;
    await setWhen(dialog, newTime);
    await dialog.getByRole('button', { name: L.scheduleEditSubmit, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleSaved);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const row = await rowOf(id);
    expect(row.subject).toBe(`Despues ${tag}`);
    expect(row.status).toBe('scheduled');
    expect(Math.abs((row.send_at as Date).getTime() - newTime)).toBeLessThan(2 * MIN);
    expect(await rowsFor(withEmail.id)).toHaveLength(1);
    await expect(timelineCard(page, `Despues ${tag}`)).toBeVisible();
  });

  test('a time past 30 days keeps the edit dialog open with the hint', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Lejos ${tag}` });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    await timelineCard(page, `Lejos ${tag}`).getByRole('button', { name: L.schedActionChangeTime, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(L.scheduleEditTitle) });
    await setWhen(dialog, Date.now() + 31 * DAY);
    await expect(dialog.getByText(L.errorScheduleTooFar)).toBeVisible();
    await expect(dialog.getByRole('button', { name: L.scheduleEditSubmit, exact: true })).toBeDisabled();
    expect((await rowOf(id)).status).toBe('scheduled');
  });

  test('"Cancelar envío" asks first; keeping leaves the row, confirming cancels it and leaves a system line', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Cancelar ${tag}` });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Cancelar ${tag}`);
    await card.getByRole('button', { name: L.schedActionCancel, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: L.schedCancelTitle });
    await expect(dialog).toContainText(`Cancelar ${tag}`);
    await dialog.getByRole('button', { name: L.schedCancelKeep, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await rowOf(id)).status).toBe('scheduled');

    await card.getByRole('button', { name: L.schedActionCancel, exact: true }).click();
    await page.getByRole('dialog', { name: L.schedCancelTitle }).getByRole('button', { name: L.schedActionCancel, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleCancelled);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await rowOf(id)).status).toBe('cancelled');

    const line = page.locator('.tl-card.system').filter({ hasText: L.schedCancelledWhat });
    await expect(line).toContainText(`Cancelar ${tag}`);
    await expect(line).toContainText(L.schedCancelledBodyAfter);
    await expect(page.locator('#scheduled-emails .tl-card:not(.system)')).toHaveCount(0); // no pending card is left
    const [{ n }] = await sql`select count(*)::int as n from activity where person_id = ${withEmail.id}`;
    expect(n).toBe(0); // cancelling is not a touch either
  });

  test('within 2 minutes of the send time the card is locked: it says so and offers no buttons', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: 60_000, subject: `Bloqueado ${tag}` });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Bloqueado ${tag}`);
    await expect(card).toContainText(L.schedLocked);
    await expect(card.getByRole('button')).toHaveCount(0);
    expect((await rowOf(id)).status).toBe('scheduled');
  });

  test('a reply puts the row on hold: the card shows the reply and "Enviar igual" makes it due without pausing again', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `Pausa ${tag}`, status: 'on_hold' });
    const [m] = await sql`
      insert into email_message (bd_id, person_id, gmail_message_id, gmail_thread_id, direction, from_address, subject, body_text, sent_at, matched_email, match_confidence)
      values (${bdId}, ${withEmail.id}, ${`zzsched-${tag}-reply`}, ${`zzsched-${tag}-thread`}, 'inbound', ${withEmail.email}, 'Re: algo', 'Gracias, lo vemos con el equipo.', ${new Date(Date.now() - HOUR / 2)}, ${withEmail.email}, 'exact')
      returning id`;
    await sql`insert into email_message_person (email_message_id, person_id, matched_email, match_confidence) values (${m!.id}, ${withEmail.id}, ${withEmail.email}, 'exact')`;
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Pausa ${tag}`);
    await expect(card.locator('.what')).toContainText(L.schedHoldTitle);
    await expect(card.locator('.badge')).toContainText(L.schedHoldReplied);
    await expect(card.locator('.tl-body')).toContainText('Gracias, lo vemos con el equipo.');
    await expect(card.locator('.tl-body')).toContainText(L.schedHoldBodyAfter);
    await expect(card.getByRole('button', { name: L.schedActionEdit, exact: true })).toBeVisible();

    await card.getByRole('button', { name: L.schedActionSendAnyway, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleSendNow);
    const row = await rowOf(id);
    expect(row.status).toBe('scheduled');
    expect(Math.abs((row.send_at as Date).getTime() - Date.now())).toBeLessThan(MIN);
    expect((row.reply_baseline_at as Date).getTime()).toBeGreaterThan(Date.now() - MIN); // the old reply cannot pause it again
  });

  test('a dead-token row keeps its text, offers "Reconectar Gmail", and "Enviar ahora" waits for the reconnection', async ({ page }) => {
    await sql`update email_account set status = 'revoked' where id = ${accountId}`;
    const id = await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `Caido ${tag}`, status: 'failed', error: 'gmail_not_connected' });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Caido ${tag}`);
    await expect(card.locator('.what')).toContainText(`${L.schedFailedTitle} · Caido ${tag}`);
    await expect(card.locator('.badge')).toHaveText(L.schedFailedGmail);
    await expect(card.getByRole('link', { name: L.schedReconnect })).toHaveAttribute('href', '/account/email');
    await expect(card.getByRole('button', { name: L.schedActionSendNow, exact: true })).toBeDisabled();

    await sql`update email_account set status = 'connected' where id = ${accountId}`;
    await page.reload();
    const again = timelineCard(page, `Caido ${tag}`);
    await expect(again.getByRole('button', { name: L.schedActionSendNow, exact: true })).toBeEnabled();
    await again.getByRole('button', { name: L.schedActionReschedule, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(L.scheduleEditTitle) });
    await expect(dialog.getByText(L.scheduleTooSoonHint)).toBeVisible(); // its old time has passed: a new one is required
    await setWhen(dialog, Date.now() + 2 * HOUR);
    await dialog.getByRole('button', { name: L.scheduleEditSubmit, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleSaved);
    const row = await rowOf(id);
    expect([row.status, row.error]).toEqual(['scheduled', null]);
  });

  test('a failed send whose outcome is unknown asks before sending again; a provable failure does not', async ({ page }) => {
    const unknown = await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `Dudoso ${tag}`, status: 'failed', error: 'outcome_unknown' });
    const clean = await seedScheduled(withEmail.id, { inMs: -2 * HOUR, subject: `Limpio ${tag}`, status: 'failed', error: 'gmail_unavailable' });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const doubtful = timelineCard(page, `Dudoso ${tag}`);
    await expect(doubtful.locator('.badge')).toHaveText(L.schedFailedUnconfirmed);
    await expect(doubtful.locator('.tl-body')).toContainText(L.schedFailedBodyUnconfirmed);
    await doubtful.getByRole('button', { name: L.schedActionSendNow, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: L.schedConfirmTitle });
    await expect(dialog).toContainText(L.schedConfirmBody);
    await dialog.getByRole('button', { name: L.cancel, exact: true }).click();
    expect((await rowOf(unknown)).status).toBe('failed'); // declining changes nothing
    await doubtful.getByRole('button', { name: L.schedActionSendNow, exact: true }).click();
    await page.getByRole('dialog', { name: L.schedConfirmTitle }).getByRole('button', { name: L.schedActionSendAnyway, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleSendNow);
    expect((await rowOf(unknown)).status).toBe('scheduled');

    const provable = timelineCard(page, `Limpio ${tag}`);
    await expect(provable.locator('.badge')).toHaveText(L.schedFailedOther);
    await expect(provable.locator('.tl-body')).toContainText(L.schedFailedBodyOther);
    await provable.getByRole('button', { name: L.schedActionSendNow, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); // no confirmation: it provably did not go out
    await expect.poll(async () => (await rowOf(clean)).status).toBe('scheduled');
  });

  test('a row that crosses the 2 minute lock while the page is open loses its buttons without a reload', async ({ page }) => {
    test.setTimeout(120_000);
    await seedScheduled(withEmail.id, { inMs: 2 * MIN + 15_000, subject: `Cruza ${tag}` });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    const card = timelineCard(page, `Cruza ${tag}`);
    await expect(card.getByRole('button', { name: L.schedActionEdit, exact: true })).toBeVisible();
    await expect(card).toContainText(L.schedLocked, { timeout: 60_000 }); // the view ticks every 30 s
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('another BD\'s scheduled email to the same contact is invisible', async ({ page }) => {
    await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Ajeno ${tag}`, owner: otherBdId });
    await gotoAuthed(page, `/contacts/${withEmail.id}`);
    await expect(page.locator('#scheduled-emails')).toBeAttached(); // the anchor never dead-ends, even with nothing pending
    await expect(page.locator('#scheduled-emails .tl-card')).toHaveCount(0);
    await expect(page.getByText(`Ajeno ${tag}`)).toHaveCount(0);
  });

  test('the composer warns when this contact already has one pending, and "Verlo" closes it and jumps to the card', async ({ page }) => {
    await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Previo ${tag}` });
    const composer = await openComposer(page, withEmail.id);
    const notice = composer.locator('.alert-info');
    await expect(notice).toContainText(`${L.scheduledAlreadyTitle} ${withEmail.name}`);
    await expect(notice).toContainText(`Previo ${tag}`);
    await notice.getByRole('link', { name: L.scheduledAlreadyView }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#scheduled-emails$/);
    await expect(timelineCard(page, `Previo ${tag}`)).toBeVisible();
  });
});

test.describe('Scheduled send: the "Programados" screen', () => {
  const sidebarPill = (page: Page) => page.locator('.sidenav a.nav-item', { hasText: es.nav.scheduled }).locator('.pill-count');

  test('lists only my rows, soonest first, with state badges, both zones and the footer', async ({ page }) => {
    await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Normal ${tag}` });
    await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `Pausado ${tag}`, status: 'on_hold' });
    await seedScheduled(withEmail.id, { inMs: -2 * HOUR, subject: `Fallido ${tag}`, status: 'failed', error: 'outcome_unknown' });
    await seedScheduled(withEmail.id, { inMs: 60_000, subject: `Saliendo ${tag}` });
    await seedScheduled(withEmail.id, { inMs: 4 * HOUR, subject: `Cancelado ${tag}`, status: 'cancelled' });
    await seedScheduled(withEmail.id, { inMs: 4 * HOUR, subject: `Enviado ${tag}`, status: 'sent' });
    await seedScheduled(withEmail.id, { inMs: 4 * HOUR, subject: `Ajeno ${tag}`, owner: otherBdId });
    await gotoAuthed(page, '/scheduled');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(L.schedPageTitle);
    await expect(page.locator('.page-header')).toContainText(L.schedPageOnlyYours);
    await expect(page.locator('.sidenav a.nav-item.active')).toContainText(es.nav.scheduled);
    await expect(page.locator('.breadcrumbs')).toContainText(es.nav.scheduled);

    const rows = page.locator('table.data tbody tr');
    await expect(rows).toHaveCount(4); // failed, on hold, locked, scheduled: not cancelled, not sent, not another BD's
    await expect(rows.nth(0)).toContainText(`Fallido ${tag}`);
    await expect(rows.nth(1)).toContainText(`Pausado ${tag}`);
    await expect(rows.nth(2)).toContainText(`Saliendo ${tag}`);
    await expect(rows.nth(3)).toContainText(`Normal ${tag}`);
    await expect(rows.nth(0).locator('.badge')).toHaveText(L.schedStateFailedUnconfirmed);
    await expect(rows.nth(0).locator('.meta').last()).toContainText(L.schedWasPrefix);
    await expect(rows.nth(1).locator('.badge')).toHaveText(L.schedStateOnHold);
    await expect(rows.nth(2).locator('.badge')).toHaveText(L.schedStateLocked);
    await expect(rows.nth(3).locator('.badge')).toHaveText(L.schedStateScheduled);
    await expect(rows.nth(3).locator('td').nth(2)).toContainText(L.schedMiamiPrefix);
    await expect(rows.nth(3).locator('td').first().locator('a')).toHaveText(withEmail.name);
    await expect(rows.nth(3).locator('td').first()).toContainText('Acme Pruebas');
    await expect(rows.nth(2).getByRole('button')).toHaveCount(0); // locked: no menu

    await expect(page.locator('.table-footer')).toContainText(`4 ${L.schedFooterMany}`);
    await expect(page.locator('.table-footer')).toContainText(L.schedFooterOrder);
    await expect(sidebarPill(page)).toHaveText('4'); // scheduled + on hold + failed + the one about to go out; cancelled, sent and another BD's do not count
  });

  test('each state\'s menu offers exactly its actions', async ({ page }) => {
    await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `M1 ${tag}` });
    await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `M2 ${tag}`, status: 'on_hold' });
    await seedScheduled(withEmail.id, { inMs: -2 * HOUR, subject: `M3 ${tag}`, status: 'failed', error: 'gmail_not_connected' });
    await gotoAuthed(page, '/scheduled');
    const menuFor = async (subject: string) => {
      const row = page.locator('table.data tbody tr').filter({ hasText: subject });
      await row.getByRole('button', { name: `${L.schedMoreActions} ${withEmail.name}` }).click();
      return page.getByRole('menu').getByRole('menuitem');
    };
    await expect(await menuFor(`M1 ${tag}`)).toHaveText([L.schedActionEdit, L.schedActionChangeTime, L.schedActionSendNow, L.schedActionCancel]);
    await page.keyboard.press('Escape');
    await expect(await menuFor(`M2 ${tag}`)).toHaveText([L.schedActionSendAnyway, L.schedActionEdit, L.schedActionCancel]);
    await page.keyboard.press('Escape');
    await expect(await menuFor(`M3 ${tag}`)).toHaveText([L.schedActionSendNow, L.schedActionReschedule, L.schedActionEdit, L.schedActionCancel]);
  });

  test('a dead Gmail shows the red banner with the count and a way to reconnect', async ({ page }) => {
    await sql`update email_account set status = 'revoked' where id = ${accountId}`;
    await seedScheduled(withEmail.id, { inMs: -HOUR, subject: `Banner ${tag}`, status: 'failed', error: 'gmail_not_connected' });
    await gotoAuthed(page, '/scheduled');
    const banner = page.locator('.alert-danger').filter({ hasText: L.schedBannerTitle });
    await expect(banner).toContainText(L.schedBannerOne);
    await expect(banner.getByRole('link', { name: L.schedReconnect })).toHaveAttribute('href', '/account/email');
    await expect(banner.getByRole('link', { name: L.schedBannerWhat })).toHaveAttribute('href', `/contacts/${withEmail.id}#scheduled-emails`);
    const row = page.locator('table.data tbody tr').filter({ hasText: `Banner ${tag}` });
    await row.getByRole('button', { name: `${L.schedMoreActions} ${withEmail.name}` }).click();
    await expect(page.getByRole('menuitem', { name: L.schedActionSendNow, exact: true })).toBeDisabled();
  });

  test('edit and cancel work from the table menu', async ({ page }) => {
    const id = await seedScheduled(withEmail.id, { inMs: 3 * HOUR, subject: `Lista ${tag}` });
    await gotoAuthed(page, '/scheduled');
    const row = () => page.locator('table.data tbody tr').filter({ hasText: `Lista ${tag}` });
    const openMenu = () => row().getByRole('button', { name: `${L.schedMoreActions} ${withEmail.name}` }).click();

    await openMenu();
    await page.getByRole('menuitem', { name: L.schedActionEdit, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(L.scheduleEditTitle) });
    await dialog.getByLabel(L.emailSubjectLabel).fill(`Editada ${tag}`);
    await dialog.getByRole('button', { name: L.scheduleEditSubmit, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleSaved);
    expect((await rowOf(id)).subject).toBe(`Editada ${tag}`);
    await expect(page.locator('table.data tbody tr').filter({ hasText: `Editada ${tag}` })).toHaveCount(1);

    await page.locator('table.data tbody tr').filter({ hasText: `Editada ${tag}` }).getByRole('button', { name: `${L.schedMoreActions} ${withEmail.name}` }).click();
    await page.getByRole('menuitem', { name: L.schedActionCancel, exact: true }).click();
    await page.getByRole('dialog', { name: L.schedCancelTitle }).getByRole('button', { name: L.schedActionCancel, exact: true }).click();
    await expect(page.locator('#toast-region')).toContainText(L.toastScheduleCancelled);
    expect((await rowOf(id)).status).toBe('cancelled');
    await expect(page.getByText(`Editada ${tag}`)).toHaveCount(0);
    await expect(page.getByText(L.schedEmpty)).toBeVisible();
  });
});
