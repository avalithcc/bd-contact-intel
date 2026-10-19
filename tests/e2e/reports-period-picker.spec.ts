import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from './fixtures';
import { gotoAuthed, skipUnlessWritesAllowed, skipWithoutCredentials } from './helpers';
import { ADMIN_STORAGE_STATE, e2eAdminEmail, ensureBd, openScratchDb, saveLoginState, type ScratchSql } from './scratchDb';
import { es } from '../../src/lib/i18n/dictionaries/es';

skipWithoutCredentials();
// Ensures the admin BD row exists in the scratch database.
skipUnlessWritesAllowed();

/**
 * Admin → Reportes, "Personalizado" range calendar (reports-period-picker). The owner saw the two months render on top of
 * each other with squeezed weekday columns; this opens the popover as an admin and checks the real layout: the two
 * months sit side by side without overlapping, and every month grid fits inside its own calendar.
 */

let sql: ScratchSql;

test.beforeAll(async ({ browser }) => {
  sql = openScratchDb();
  await ensureBd(sql, e2eAdminEmail(), 'ZZ E2E Admin (no asignar)', 'admin');
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('baseURL is not configured');
  // Playwright applies the describe's storageState to every new context, the login one included, so the file must exist
  // (empty) before the first login on a clean checkout.
  if (!existsSync(ADMIN_STORAGE_STATE)) {
    mkdirSync(dirname(ADMIN_STORAGE_STATE), { recursive: true });
    writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }));
  }
  await saveLoginState(browser, baseURL, e2eAdminEmail(), ADMIN_STORAGE_STATE);
});

test.afterAll(async () => {
  await sql?.end();
});

test.describe('Reportes: custom range calendar', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test('the two months sit side by side and each grid fits its calendar', async ({ page }, testInfo) => {
    await gotoAuthed(page, '/admin/reports');
    await page.getByRole('button', { name: new RegExp(es.reports.periodCustom) }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const calendars = dialog.locator('.cal');
    await expect(calendars).toHaveCount(2);
    const [left, right] = await Promise.all([calendars.nth(0).boundingBox(), calendars.nth(1).boundingBox()]);
    if (!left || !right) throw new Error('calendar not rendered');
    expect(left.x + left.width, 'the left month must end before the right month starts').toBeLessThanOrEqual(right.x);

    for (const index of [0, 1]) {
      const cal = calendars.nth(index);
      // The grid box itself is clamped to the calendar width; what overflowed were its columns, so measure the last
      // weekday header (the 7th column) against the calendar's right edge.
      const [box, lastColumn] = await Promise.all([cal.boundingBox(), cal.locator('.dow').nth(6).boundingBox()]);
      if (!box || !lastColumn) throw new Error('calendar grid not rendered');
      expect(lastColumn.x + lastColumn.width, `month ${index + 1}: the 7th column must fit inside its calendar`).toBeLessThanOrEqual(box.x + box.width + 1);
    }


    await page.screenshot({ path: testInfo.outputPath('period-picker.png') });
  });
});
