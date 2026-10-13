import postgres from 'postgres';
import { test, expect } from './fixtures';
import { es } from '../../src/lib/i18n/dictionaries/es';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

// The e2e account's true baseline: the seed inserts it with the default role.
// Restored to this constant, never to a value read from the database, because
// a hard kill between setRole('admin') and afterEach would otherwise make the
// next run read 'admin' as the "original" and make the leak permanent.
const BASELINE_ROLE = 'bd';

/**
 * Admin conversation access and its audit trail (admin-access-audit spec:
 * "Admin conversation views are audit-logged" / "Non-admins cannot read other
 * BDs' conversation content").
 *
 * The entry point is the modal on `/contacts/:id?conversation=<bdId>`
 * (AdminConversationAutoOpen.tsx), reached from Administración -> Registro de
 * auditoría's "Abrir" link. The standalone `/contacts/:id/conversation/:bdId`
 * page this file used to target was deleted (owner decision 2026-09-30).
 *
 * The audit row is written by the `revealAdminConversationAction` server
 * action, so these tests write and run on a scratch database only
 * (skipUnlessWritesAllowed). The same property makes a direct read of
 * `audit_log` safe: DATABASE_URL is known to be a local `*_e2e` database by
 * the time any test body runs. Role is flipped on the e2e account's own `bd`
 * row for the test and restored afterwards; the seed
 * (scripts/seed-launch-readiness.ts) provides the second BD and the contacts.
 *
 * Not covered here: the "Ver conversación" confirm step on the record's
 * history card (needs seeded email_message / conversation rows), the
 * Administración -> Registro de auditoría list itself, the action's
 * `not_found` result (unknown person or BD), the `not_admin` result via a
 * direct action call (the non-admin test below never invokes the action; it
 * only proves the modal does not mount), and any behaviour for a session
 * with no `bd` row (that is getCurrentBd's job, proved by hand, see
 * tests/e2e/README.md).
 *
 * Role safety: the hook restores the role to BASELINE_ROLE, and
 * scripts/seed-launch-readiness.ts resets it on conflict, so a hard kill
 * (Ctrl-C, crashed worker) mid-test is repaired by the next rebuild.
 */
test.describe('Admin conversation access and audit', () => {
  let sql: ReturnType<typeof postgres> | undefined;
  let meId: string;
  let otherBdId: string;
  let personId: string;

  test.beforeEach(async () => {
    skipUnlessWritesAllowed();
    meId = '';
    sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const [me] = await sql`select id from bd where email = ${process.env.E2E_EMAIL!}`;
    expect(me, 'the e2e account has no bd row in the scratch database; re-run the seed').toBeTruthy();
    const [other] = await sql`select id from bd where id <> ${me.id} order by email limit 1`;
    const [person] = await sql`select id from person order by id limit 1`;
    expect(other, 'the scratch database needs a second bd (the seed creates one)').toBeTruthy();
    expect(person, 'the scratch database has no person (run the seed)').toBeTruthy();
    meId = me.id;
    otherBdId = other.id;
    personId = person.id;
  });

  test.afterEach(async () => {
    // beforeEach may have exited before meId was set (a failed expect); the
    // connection must still be closed.
    const conn = sql;
    sql = undefined;
    if (!conn) return;
    try {
      if (meId) await conn`update bd set role = ${BASELINE_ROLE} where id = ${meId}`;
    } finally {
      await conn.end();
    }
  });

  const setRole = (role: 'admin' | 'bd') => sql!`update bd set role = ${role} where id = ${meId}`;
  const auditRows = async () => {
    const [row] = await sql!`
      select count(*)::int as n from audit_log
      where action = 'view_conversation' and person_id = ${personId} and target_bd_id = ${otherBdId}`;
    return row.n as number;
  };

  test("admin opening another BD's conversation writes exactly one audit row", async ({ page }) => {
    await setRole('admin');
    const before = await auditRows();

    await gotoAuthed(page, `/contacts/${personId}?conversation=${otherBdId}`);
    // The audit banner only renders once the audited fetch has returned.
    // Scoped to the banner AdminConversationFlow renders (prefix + the target
    // BD's name): ".alert-audit" alone also matches the confirm step in
    // AdminViewConversationDialog, which is not mounted on this path.
    await expect(
      page.locator('.alert-audit', { hasText: es.contactRecord.adminAuditBannerPrefix }).filter({ hasText: 'ZZ Otro BD' }),
    ).toBeVisible();
    await expect(page.getByText(es.contactRecord.adminAuditConfirmTitle)).toHaveCount(0);
    expect(await auditRows()).toBe(before + 1);

    // `next dev` double-invokes mount effects; a late second fetch would land here.
    await page.waitForTimeout(1_000);
    expect(await auditRows()).toBe(before + 1);
  });

  test("a non-admin gets no conversation modal and writes no audit row", async ({ page }) => {
    await setRole('bd');
    const before = await auditRows();

    await gotoAuthed(page, `/contacts/${personId}?conversation=${otherBdId}`);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(1_000);

    await expect(page.locator('.alert-audit')).toHaveCount(0);
    expect(await auditRows()).toBe(before);
  });

  test('a malformed ?conversation= value never mounts the flow or writes', async ({ page }) => {
    await setRole('admin');
    const before = await auditRows();

    await gotoAuthed(page, `/contacts/${personId}?conversation=not-a-uuid`);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(1_000);

    await expect(page.locator('.alert-audit')).toHaveCount(0);
    expect(await auditRows()).toBe(before);
  });
});
