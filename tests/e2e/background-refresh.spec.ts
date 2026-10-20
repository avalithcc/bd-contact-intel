import { test, expect } from './fixtures';
import { gotoAuthed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

/**
 * Live updates (src/components/LiveUpdates.tsx). Screens refresh on a push from the database, never on a timer. Proves in
 * a real browser that (1) an idle screen makes no refresh request of its own, and (2) no common screen is permanently
 * "busy" at rest — a menu/listbox/dialog that is always mounted would hold a live refresh back for that screen forever.
 * The push path itself (trigger -> Realtime -> browser) needs Supabase Realtime and is verified against the real project.
 */

const BUSY_AT_REST = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-busy="true"], [data-dirty="true"]';

for (const path of ['/contacts', '/tasks', '/follow-ups', '/reuniones', '/scheduled']) {
  test(`${path} is not busy at rest`, async ({ page }) => {
    await gotoAuthed(page, path);
    const busy = await page.locator(BUSY_AT_REST).evaluateAll((els) => els.map((el) => el.outerHTML.slice(0, 160)));
    expect(busy, `elements that would hold a live refresh back on ${path}`).toEqual([]);
  });
}

test('an idle screen makes no refresh request of its own', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoAuthed(page, '/tasks');

  const refreshes: number[] = [];
  page.on('request', (req) => {
    if (req.headers()['rsc'] === '1' && new URL(req.url()).pathname === '/tasks') refreshes.push(Date.now());
  });

  // The old poller fired after 60 s; wait past it. Without a database event nothing may re-fetch the screen.
  await page.waitForTimeout(70_000);
  expect(refreshes.length, 'no RSC request without an event').toBe(0);
});
