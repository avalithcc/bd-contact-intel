/**
 * F5 (fixed): first thing in the morning the follow-up queue for today does
 * not exist yet. The shell now builds it on the first page of the day
 * (src/lib/shell/readBadgeRowEnsuringQueue.ts), so the sidebar badge shows
 * the number without Mariel having to open Seguimientos first.
 *
 * KNOWN LIMITATION — this file only passes when it is the FIRST thing to touch
 * the app on a freshly started server. It is NOT a dependency on 05 (that was
 * the earlier guess, and it is wrong): measured 2026-10-13, `06` alone with
 * `--repeat-each=3` passes repeat 1 and fails repeats 2 and 3, with no other
 * spec involved. `05` merely happens to warm the server first.
 *
 * Why: both tests below `delete from follow_up_queue_item` and then expect the
 * shell to rebuild it. The rebuild is memoized per server PROCESS, in the
 * module-level `queueBuildAttempted` set (src/lib/shell/appShellBadgeCounts.ts:37)
 * keyed `${bdId}:${queueDate}` (built at `:83`) and recorded BEFORE the build
 * runs (readBadgeRowEnsuringQueue.ts:48-49). Once the first page load of the day has
 * recorded that key, the shell never rebuilds on that instance, so a later
 * delete is never undone and the badge reads 0. In production nothing deletes
 * queue rows, so the memo is correct there — this is a test-harness problem,
 * not an app defect, and app behaviour must NOT be changed to satisfy it.
 *
 * Not established: why test 2 passes when `06` runs alone. `/follow-ups`
 * appears to build the queue through its own path (the cards are non-zero while
 * the badge is 0), so the two reads can disagree. Unverified.
 *
 * The fix, when someone wants it: give this file its own Playwright project
 * with its own `next dev` server on a dedicated port. A test cannot clear
 * another process's module-level Set.
 */
import { expect } from '@playwright/test';
import { sql, test } from './helpers';

test('the sidebar badge shows today\'s follow-ups on the first page of the day, before she opens the queue', async ({ page }) => {
  await sql`delete from follow_up_queue_item`;
  await page.goto('/contacts');
  await page.waitForLoadState('networkidle');
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(text.replace(/\D+/g, ''), 'no number next to Seguimientos although follow-ups are due').not.toBe('');
});

test('the first visit to /follow-ups shows the same number in the sidebar as there are cards', async ({ page }) => {
  await sql`delete from follow_up_queue_item`;
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  const cards = await page.locator('main .card a.strong').count();
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(cards).toBeGreaterThan(0);
  expect(Number(text.replace(/\D+/g, '') || 0)).toBe(cards);
});
