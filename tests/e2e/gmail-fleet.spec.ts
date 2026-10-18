import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { ADMIN_STORAGE_STATE, e2eAdminEmail, e2eBdEmail, ensureBd, openScratchDb, runTag, saveLoginState, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

const D = es.gmailFleet;

skipWithoutCredentials();
// Seeds BDs, an email account and messages in the scratch database.
skipUnlessWritesAllowed();

/**
 * Admin "Estado de Gmail" (gmail-sync-fleet). Renders the real page on the scratch stack as an admin and as a BD, and the two
 * shell pages every user opens (/contacts, /account), failing on an error boundary or on a "Attempted to call" server/client
 * boundary error in the page or in the console. Nothing here sends mail or calls Gmail: the account rows carry no token.
 */

const tag = runTag();
const okEmail = `zz-fleet-ok-${tag}@example.test`;
const reconnectEmail = `zz-fleet-reconnect-${tag}@example.test`;
const neverEmail = `zz-fleet-never-${tag}@example.test`;
let sql: ScratchSql;
let okId: string;
let reconnectId: string;
let neverId: string;

test.beforeAll(async ({ browser }) => {
  sql = openScratchDb();
  try {
    await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    await ensureBd(sql, e2eAdminEmail(), 'ZZ E2E Admin (no asignar)', 'admin');
    okId = await ensureBd(sql, okEmail, `ZZ E2E Fleet Ok ${tag}`, 'bd');
    reconnectId = await ensureBd(sql, reconnectEmail, `ZZ E2E Fleet Reconnect ${tag}`, 'bd');
    neverId = await ensureBd(sql, neverEmail, `ZZ E2E Fleet Never ${tag}`, 'bd');
    // ensureBd switches reminders off; the fleet only monitors a BD without an account when reminders are on.
    await sql`update bd set email_reminders_enabled = true where id = ${neverId}`;
    await sql`insert into email_account (bd_id, email_address, status, granted_scopes, last_synced_at, history_id)
      values (${okId}, ${okEmail}, 'connected', 'https://www.googleapis.com/auth/gmail.readonly', now() - interval '2 minutes', '1')`;
    // Connected before the read scope existed: the BD's own red banner case.
    await sql`insert into email_account (bd_id, email_address, status, granted_scopes, last_synced_at)
      values (${reconnectId}, ${reconnectEmail}, 'connected', 'https://www.googleapis.com/auth/gmail.send', now() - interval '11 days')`;
    await sql`insert into email_message (bd_id, gmail_message_id, gmail_thread_id, direction, from_address, sent_at, matched_email, match_confidence)
      values (${okId}, ${`m-${tag}`}, ${`t-${tag}`}, 'inbound', 'x@prospect.test', now() - interval '13 minutes', 'x@prospect.test', 'exact')`;
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
  await sql`delete from bd where id in ${sql([okId, reconnectId, neverId].filter(Boolean))}`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    await cleanup();
  } finally {
    await sql.end();
  }
});

/** Collects console errors and uncaught page errors; the specs assert none mentions the server/client boundary. */
function watchErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') seen.push(`console: ${m.text()}`);
  });
  return seen;
}

async function expectNoCrash(page: Page, seen: string[]) {
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
  expect(seen.filter((m) => /Attempted to call|Server Components render/i.test(m)), seen.join('\n')).toEqual([]);
}

test.describe('Estado de Gmail: the admin view', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('renders the fleet with the stats, the seeded BDs and the sidebar entry', async ({ page }, testInfo) => {
    const seen = watchErrors(page);
    await gotoAuthed(page, '/admin/gmail');
    await expect(page.locator('h1')).toContainText(D.title);
    await expect(page.locator('.stat')).toHaveCount(4);
    await expect(page.locator('.stat .label').first()).toHaveText(D.statHealthy);
    await expect(page.locator('nav.sidenav a[href="/admin/gmail"]')).toHaveText(new RegExp(D.title));

    const ok = page.locator('table.data tbody tr', { hasText: okEmail });
    await expect(ok.locator('.badge-success')).toHaveText(D.chipConnected);
    await expect(ok).toContainText('recibido');
    const reconnect = page.locator('table.data tbody tr', { hasText: reconnectEmail });
    await expect(reconnect.locator('.badge-danger')).toHaveText(D.chipReconnect);
    await expect(reconnect).toContainText(D.missingScope);
    const never = page.locator('table.data tbody tr', { hasText: neverEmail });
    await expect(never.locator('.badge-neutral')).toHaveText(D.chipNever);
    await expect(never).toContainText(D.noEmails);
    await expect(page.locator('.alert-danger .title', { hasText: `ZZ E2E Fleet Reconnect ${tag}` })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('th .tip-trigger', { hasText: new RegExp(`^${D.colConnection}$`) }).focus();
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('fleet.png') });
    await expectNoCrash(page, seen);
  });

  test('the attention filter keeps the BDs that need it and the healthy filter the rest', async ({ page }) => {
    await gotoAuthed(page, '/admin/gmail?filter=attention');
    await expect(page.locator('.segmented a.on')).toHaveText(D.filterAttention);
    await expect(page.locator('table.data tbody tr', { hasText: reconnectEmail })).toHaveCount(1);
    await expect(page.locator('table.data tbody tr', { hasText: okEmail })).toHaveCount(0);
    await gotoAuthed(page, '/admin/gmail?filter=healthy');
    await expect(page.locator('table.data tbody tr', { hasText: okEmail })).toHaveCount(1);
    await expect(page.locator('table.data tbody tr', { hasText: reconnectEmail })).toHaveCount(0);
  });

  test('a header tooltip opens on keyboard focus, is not clipped by the table, and Escape closes it', async ({ page }) => {
    await gotoAuthed(page, '/admin/gmail');
    const trigger = page.locator('th .tip-trigger', { hasText: new RegExp(`^${D.colConnection}$`) });
    const bubble = page.getByRole('tooltip').filter({ hasText: D.tips.connection.body });
    await expect(bubble).toBeHidden();
    await trigger.focus();
    await expect(bubble).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-describedby', (await bubble.getAttribute('id')) ?? '');
    const box = (await bubble.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    // Taller than the table header row: it escapes the .table-wrap overflow instead of being cut at its edge.
    const wrap = (await page.locator('.table-wrap').boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(wrap.y + 40);
    await page.keyboard.press('Escape');
    await expect(bubble).toBeHidden();
  });

  test('"Enviar recordatorio" is offered only to a BD who can get one; with no mail server the failure is told and nothing is audited', async ({ page }) => {
    await gotoAuthed(page, '/admin/gmail');
    const sendFor = (name: string) => page.getByRole('button', { name: `Enviar recordatorio a ${name}` });
    await expect(sendFor(`ZZ E2E Fleet Never ${tag}`)).toBeVisible();
    await expect(page.locator('table.data tbody tr', { hasText: okEmail }).getByRole('button')).toHaveCount(0);
    await expect(page.locator('table.data tbody tr', { hasText: e2eAdminEmail() }).getByRole('button')).toHaveCount(0);

    await sendFor(`ZZ E2E Fleet Never ${tag}`).click();
    await expect(page.getByText(D.errorSend, { exact: true })).toBeVisible();
    const audits = await sql`select count(*)::int as n from audit_log where target_bd_id = ${neverId} and action = 'gmail_reminder_manual'`;
    expect(audits[0]!.n).toBe(0);
  });

  test('the shell pages every user opens still render for an admin', async ({ page }) => {
    for (const url of ['/contacts', '/account']) {
      const seen = watchErrors(page);
      await gotoAuthed(page, url);
      await expect(page.locator('nav.sidenav')).toBeVisible();
      await expectNoCrash(page, seen);
    }
  });
});

test.describe('Estado de Gmail: a BD', () => {
  test('cannot open the admin screen', async ({ page }) => {
    const response = await page.goto('/admin/gmail');
    expect(response?.status()).toBe(404);
  });
});
