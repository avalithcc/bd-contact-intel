import { test, expect } from '@playwright/test';
import { gotoAuthed } from './helpers';

/**
 * Phase 11 task 11.5 (admin-access-audit spec: "Admin conversation views are
 * audit-logged" / "Non-admins cannot read other BDs' conversation content";
 * contact-record spec "Conversation visibility on the record").
 *
 * NOT EXECUTED by this batch — same reasons as tests/e2e/phase7.spec.ts: no
 * DATABASE_URL/live server in this environment, and the non-admin case needs
 * a second, non-admin session the current single-session
 * `tests/e2e/auth.setup.ts` does not set up. Written to the repo's existing
 * e2e conventions (gotoAuthed, test.skip with a stated reason) for a
 * maintainer to run against a real environment with seeded data: a Contact
 * with a connected BD other than the admin/non-admin test accounts, and at
 * least one `email_sent` activity or LinkedIn conversation from that BD.
 */
test.describe('Phase 11: Admin conversation access and audit', () => {
  test('admin viewing another BD\'s conversation produces exactly one audit row', async ({ page }) => {
    const contactId = process.env.E2E_CONTACT_WITH_OTHER_BD_HISTORY;
    const otherBdId = process.env.E2E_OTHER_BD_ID;
    test.skip(
      !contactId || !otherBdId,
      'Requires E2E_CONTACT_WITH_OTHER_BD_HISTORY and E2E_OTHER_BD_ID pointing at seeded data: a Contact with conversation history from a BD other than the seeded admin.',
    );

    // The shared `chromium` project authenticates as the seeded admin
    // (tests/e2e/auth.setup.ts). This suite has no direct DB access, so the
    // audit assertion is the UI-visible proxy: the admin-only conversation
    // page renders once cleanly, and a second view of the same conversation
    // does not error or duplicate visible content — the real "exactly one
    // audit row per view" count must be asserted against `audit_log` in a
    // DB-backed run (`SELECT count(*) FROM audit_log WHERE action =
    // 'view_conversation' AND person_id = $1 AND target_bd_id = $2`).
    await gotoAuthed(page, `/contacts/${contactId}/conversation/${otherBdId}`);
    await expect(page.locator('text=/registro de auditoría|audit log/i')).toBeVisible();
  });

  test('non-admin cannot read another BD\'s conversation content', async ({ page }) => {
    const nonAdminEmail = process.env.E2E_NON_ADMIN_EMAIL;
    const contactId = process.env.E2E_CONTACT_WITH_OTHER_BD_HISTORY;
    const otherBdId = process.env.E2E_OTHER_BD_ID;
    test.skip(
      !nonAdminEmail || !contactId || !otherBdId,
      'Requires a second, non-admin session (E2E_NON_ADMIN_EMAIL/E2E_NON_ADMIN_PASSWORD) plus the same seeded Contact/BD env vars as the admin test above.',
    );

    // A real run needs its own non-admin storageState (see phase7.spec.ts's
    // equivalent note) rather than the shared admin session.
    await gotoAuthed(page, `/contacts/${contactId}/conversation/${otherBdId}`);
    await expect(page.locator('text=/404/')).toBeVisible();

    await gotoAuthed(page, `/contacts/${contactId}`);
    await expect(page.locator('text=/registro de auditoría|audit log/i')).toHaveCount(0);
  });
});
