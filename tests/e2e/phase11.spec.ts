import postgres from 'postgres';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

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
 * history card (needs seeded email_message / conversation rows), and the
 * Administración -> Registro de auditoría list itself.
 */
test.describe('Admin conversation access and audit', () => {
  let sql: ReturnType<typeof postgres>;
  let meId: string;
  let originalRole: string;
  let otherBdId: string;
  let personId: string;

  test.beforeEach(async () => {
    skipUnlessWritesAllowed();
    sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const [me] = await sql`select id, role from bd where email = ${process.env.E2E_EMAIL!}`;
    const [other] = await sql`select id from bd where id <> ${me.id} order by email limit 1`;
    const [person] = await sql`select id from person order by id limit 1`;
    expect(me, 'the e2e account has no bd row in the scratch database; re-run the seed').toBeTruthy();
    expect(other, 'the scratch database needs a second bd (the seed creates one)').toBeTruthy();
    expect(person, 'the scratch database has no person (run the seed)').toBeTruthy();
    meId = me.id;
    originalRole = me.role;
    otherBdId = other.id;
    personId = person.id;
  });

  test.afterEach(async () => {
    if (!sql) return;
    await sql`update bd set role = ${originalRole} where id = ${meId}`;
    await sql.end();
  });

  const setRole = (role: 'admin' | 'bd') => sql`update bd set role = ${role} where id = ${meId}`;
  const auditRows = async () => {
    const [row] = await sql`
      select count(*)::int as n from audit_log
      where action = 'view_conversation' and person_id = ${personId} and target_bd_id = ${otherBdId}`;
    return row.n as number;
  };

  test("admin opening another BD's conversation writes exactly one audit row", async ({ page }) => {
    await setRole('admin');
    const before = await auditRows();

    await gotoAuthed(page, `/contacts/${personId}?conversation=${otherBdId}`);
    // The audit banner only renders once the audited fetch has returned.
    await expect(page.locator('.alert-audit')).toBeVisible();
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
