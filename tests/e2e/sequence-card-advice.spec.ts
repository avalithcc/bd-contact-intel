import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { e2eBdEmail, ensureBd, ensureEmailAccount, openScratchDb, runTag, type ScratchSql } from './scratchDb';

skipWithoutCredentials();
// Seeds a Sequence with a drafted member straight into the database: scratch only.
skipUnlessWritesAllowed();

/**
 * Regression for the send-time warning on a draft member card (send-now-or-schedule). The advice used to render as a full
 * alert block inside the card's actions row, squeezing the member's column to a sliver. It must now be a compact chip under
 * the split button (full sentence in a tooltip) and the card must keep its layout, even at 1024px.
 *
 * "Now" is frozen at Tuesday 2026-10-20 12:26 UTC, which is 8:26 in Waterloo, Canada: before 9:00 for the recipient, so the
 * advice always fires. Nothing is sent: the spec only reads the page.
 */

const tag = runTag();
const SEQ = `ZZ Seq Advice ${tag}`;
const FIRST = `ZzAdvice${tag}`;
const FULL = `${FIRST} Waterloo`;

let sql: ScratchSql;
let accountCreated: string | null = null;
let seqId: string;

async function cleanup() {
  await sql`delete from sequence where name = ${SEQ}`;
  await sql`delete from person where email = ${`zzseqadv-${tag}@example.com`}`;
  if (accountCreated) await sql`delete from email_account where id = ${accountCreated}`;
}

test.beforeAll(async () => {
  sql = openScratchDb();
  try {
    const bdId = await ensureBd(sql, e2eBdEmail(), 'ZZ E2E (no asignar)', 'bd');
    const account = await ensureEmailAccount(sql, bdId, `seqadv-${tag}@example.com`);
    if (account.created) accountCreated = account.id;
    const [acc] = await sql`select id from email_account where bd_id = ${bdId}`;
    const [seq] = await sql`
      insert into sequence (name, owner_bd_id, email_account_id, daily_send_cap, schedule)
      values (${SEQ}, ${bdId}, ${acc!.id}, 5, ${sql.json({ step1: { hour: 9, timezone: 'America/New_York', offsetDays: 1 }, step2: { afterDays: 7 } })})
      returning id`;
    const mail = `zzseqadv-${tag}@example.com`;
    const [p] = await sql`
      insert into person (first_name, last_name, email, email_normalized, company, company_key, job_title, city, country, owner_bd_id, status)
      values (${FIRST}, 'Waterloo', ${mail}, ${mail}, 'Acme Pruebas', 'acme-pruebas', 'Director of Engineering and Platform Operations', 'Waterloo', 'Canada', ${bdId}, 'new') returning id`;
    const [m] = await sql`insert into sequence_member (sequence_id, person_id, state) values (${seq!.id}, ${p!.id}, 'drafted') returning id`;
    await sql`insert into sequence_draft (sequence_member_id, step, subject, body) values (${m!.id}, 1, ${`Asunto ${tag}`}, 'Hola, cuerpo del borrador.')`;
    seqId = seq!.id as string;
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
  test(`the send-time warning is a compact chip and the card keeps its layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-20T12:26:00Z'));
    await gotoAuthed(page, `/sequences/${seqId}`);

    const card = page.locator('.card', { has: page.getByRole('link', { name: FULL, exact: true }) }).last();
    await expect(card).toBeVisible();
    const chip = card.locator('.advice-chip .badge');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('8:26');
    await expect(chip).toContainText(FIRST);
    // The old block is gone from the row; the full sentence is in the tooltip.
    await expect(card.locator('.alert-warn')).toHaveCount(0);
    await chip.hover();
    await expect(page.getByRole('tooltip').filter({ hasText: '¿Seguro?' })).toBeVisible();

    const main = card.locator('.card-body > .grow').first();
    const [cardBox, mainBox, chipBox] = await Promise.all([card.boundingBox(), main.boundingBox(), chip.boundingBox()]);
    expect(cardBox && mainBox && chipBox).toBeTruthy();
    expect(mainBox!.width).toBeGreaterThanOrEqual(cardBox!.width * 0.4);
    expect(cardBox!.height).toBeLessThan(260);
    // The chip sits beside the main column, never over it.
    const overlapX = Math.min(mainBox!.x + mainBox!.width, chipBox!.x + chipBox!.width) - Math.max(mainBox!.x, chipBox!.x);
    const overlapY = Math.min(mainBox!.y + mainBox!.height, chipBox!.y + chipBox!.height) - Math.max(mainBox!.y, chipBox!.y);
    expect(overlapX > 0 && overlapY > 0).toBe(false);
    // No horizontal page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await card.screenshot({ path: `test-results/sequence-card-advice-${width}.png` });
  });
}
