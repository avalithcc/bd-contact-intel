import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

/**
 * Phase 7 task 7.3 (duplicate-review spec: admin-only queue, merge path).
 *
 * The suite RUNS now (a test account exists). Both tests still skip by
 * default: the non-admin case needs E2E_NON_ADMIN_EMAIL, and the merge case
 * is DESTRUCTIVE and gated behind E2E_ALLOW_DESTRUCTIVE — see its own
 * comment. Everything else in this suite is strictly read-only, because it
 * runs against PRODUCTION.
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

  /**
   * THIS TEST MERGES TWO REAL CONTACTS. It is the only write in the suite.
   *
   * It picks the FIRST pair in the live `/admin/duplicates` queue and merges
   * it, with no human judgement about whether they are the same person.
   * Production currently holds 244 open pairs, and 155 of them have no email
   * on either side — the namesake bucket where the heuristic has already been
   * measured wrong 7 times out of 9. Merging one blindly is data loss.
   *
   * It does NOT skip today because the queue is empty. It skips because the
   * e2e account is role `bd`, so /admin/duplicates serves it the 404 that the
   * test above asserts, and the queue locator finds nothing. Grant that
   * account admin, or run the suite as a real admin, and this fires.
   *
   * So it is gated explicitly. Set E2E_ALLOW_DESTRUCTIVE=1 ONLY against a
   * disposable database you are willing to lose.
   */
  test('admin merging a pair resolves it and records one merge-history row', async ({ page }) => {
    test.skip(
      process.env.E2E_ALLOW_DESTRUCTIVE !== '1',
      'DESTRUCTIVE: this test MERGES TWO REAL CONTACTS from the live duplicate queue. ' +
        'It is skipped unless E2E_ALLOW_DESTRUCTIVE=1. Never set that against production.',
    );

    // Second lock: even with the env gate set, never outside a scratch DB.
    skipUnlessWritesAllowed();

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
