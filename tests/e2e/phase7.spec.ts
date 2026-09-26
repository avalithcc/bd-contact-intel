import { test, expect } from '@playwright/test';
import { gotoAuthed } from './helpers';

/**
 * Phase 7 task 7.3 (duplicate-review spec: admin-only queue, merge path).
 *
 * NOT EXECUTED by this batch — both tests need real authenticated sessions
 * this environment cannot provide (no DATABASE_URL/live server here), and
 * the non-admin case additionally needs a second, non-admin account that
 * the current single-session `tests/e2e/auth.setup.ts` does not set up.
 * Written to the repo's existing e2e conventions (gotoAuthed, test.skip with
 * a stated reason) for a maintainer to run against a real environment.
 */
test.describe('Phase 7: Duplicate review admin page', () => {
  test('non-admin gets a 404 on /admin/duplicates', async ({ page }) => {
    const nonAdminEmail = process.env.E2E_NON_ADMIN_EMAIL;
    test.skip(
      !nonAdminEmail,
      'Requires a second, non-admin session (E2E_NON_ADMIN_EMAIL/E2E_NON_ADMIN_PASSWORD) not configured for this suite.',
    );

    // The shared `chromium` project always authenticates as the seeded
    // admin (tests/e2e/auth.setup.ts); a real run of this test needs its
    // own non-admin storageState, e.g. via a dedicated Playwright project.
    await gotoAuthed(page, '/admin/duplicates');
    await expect(page.locator('text=/404/')).toBeVisible();
  });

  test('admin merging a pair resolves it and records one merge-history row', async ({ page }) => {
    await gotoAuthed(page, '/admin/duplicates');

    const firstPair = page.locator('.duplicates-queue-item').first();
    test.skip((await firstPair.count()) === 0, 'No open duplicate pairs in this environment to merge.');

    const mergedName = (await page.locator('.duplicates-queue-item .n').first().innerText()).trim();
    const queueCountBefore = await page.locator('.duplicates-queue-item').count();
    const historyRowsBefore = await page.locator('table tbody tr', { hasText: mergedName }).count();

    await page.locator('button', { hasText: /^Fusionar en/ }).first().click();
    await page.waitForLoadState('networkidle');

    // The pair leaves the open queue (merged, no longer `status='open'`) and
    // the merge event's survivor now appears in the history table below —
    // the UI-visible proxy for "the merge wrote one audit_log row", since
    // this suite has no direct DB access to assert on `audit_log` itself.
    await expect(page.locator('.duplicates-queue-item')).toHaveCount(queueCountBefore - 1);
    const historyRowsAfter = await page.locator('table tbody tr', { hasText: mergedName }).count();
    expect(historyRowsAfter).toBeGreaterThan(historyRowsBefore);
  });
});
