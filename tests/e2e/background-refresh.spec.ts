import { test, expect } from './fixtures';
import { gotoAuthed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

/**
 * App-wide background refresh (src/components/BackgroundRefresh.tsx, src/lib/shell/refreshPolicy.ts). Proves in a real
 * browser that (1) an idle, visible screen re-fetches its server data on its own, (2) an unsaved edit pauses it, and
 * (3) no common screen is permanently "busy" at rest — a menu/listbox/dialog that is always mounted would silently
 * switch background refresh off for that screen.
 */

const BUSY_AT_REST = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-busy="true"], [data-dirty="true"]';

for (const path of ['/contacts', '/tasks', '/follow-ups', '/reuniones', '/scheduled']) {
  test(`${path} is not busy at rest`, async ({ page }) => {
    await gotoAuthed(page, path);
    const busy = await page.locator(BUSY_AT_REST).evaluateAll((els) => els.map((el) => el.outerHTML.slice(0, 160)));
    expect(busy, `elements that would pause background refresh on ${path}`).toEqual([]);
  });
}

test('an idle screen refreshes on its own, an unsaved edit pauses it', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoAuthed(page, '/tasks');
  // Shortest allowed interval (MIN_INTERVAL_MS) so the test does not wait a full minute.
  await page.evaluate(() => document.body.setAttribute('data-refresh-interval', '30000'));

  const refreshes: number[] = [];
  page.on('request', (req) => {
    if (req.headers()['rsc'] === '1' && new URL(req.url()).pathname === '/tasks') refreshes.push(Date.now());
  });

  await expect.poll(() => refreshes.length, { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(0);

  // An unsaved edit must hold the refresh back.
  await page.evaluate(() => {
    const marker = document.createElement('div');
    marker.setAttribute('data-dirty', 'true');
    document.body.appendChild(marker);
  });
  const before = refreshes.length;
  await page.waitForTimeout(50_000);
  expect(refreshes.length, 'no background refresh while something is dirty').toBe(before);
});
