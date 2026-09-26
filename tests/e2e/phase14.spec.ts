import { test, expect } from '@playwright/test';
import { gotoAuthed } from './helpers';

/**
 * Phase 14 task 14.3: full flow — import a CSV, see the dedup outcome, then
 * find the resulting Contact both on the table view and on the board view.
 *
 * NOT EXECUTED by this batch — same reasons as tests/e2e/phase7.spec.ts and
 * phase11.spec.ts: no DATABASE_URL/live server in this environment, and a
 * real run needs a throwaway CSV fixture plus a seeded BD session
 * (tests/e2e/auth.setup.ts). Written to the repo's existing e2e
 * conventions (gotoAuthed, test.skip with a stated reason) for a maintainer
 * to run against a real environment.
 *
 * Uses a LinkedIn connections CSV fixture (E2E_IMPORT_CONNECTIONS_CSV_PATH)
 * with exactly one row that is guaranteed new (a profile key/email not
 * already in the target database) so the outcome assertion is unambiguous:
 * "1 nuevo", not "1 fusionado". The row's full name
 * (E2E_IMPORT_CONNECTIONS_CSV_NAME) must match what's in that fixture, so
 * the later list/board lookups don't depend on parsing the CSV in the test.
 */
test.describe('Phase 14: import -> dedup outcome -> visible in list and board', () => {
  test('importing a new LinkedIn connection surfaces it in the outcome, the table view and the board view', async ({
    page,
  }) => {
    const csvPath = process.env.E2E_IMPORT_CONNECTIONS_CSV_PATH;
    const contactName = process.env.E2E_IMPORT_CONNECTIONS_CSV_NAME;
    test.skip(
      !csvPath || !contactName,
      'Requires E2E_IMPORT_CONNECTIONS_CSV_PATH (a Connections.csv fixture with one guaranteed-new row) and E2E_IMPORT_CONNECTIONS_CSV_NAME (that row\'s full name).',
    );

    await gotoAuthed(page, '/contacts/import');

    // 1. Import: upload the fixture via the LinkedIn connections card
    // (ConnectionsUploadForm) — task 14.2.
    await page.setInputFiles('#connections-file', csvPath!);
    await page.getByRole('button', { name: /importar|import/i }).first().click();

    // 2. Dedup outcome: the fixture's one row is a guaranteed-new profile,
    // so the outcome summary must show at least one "Contactos nuevos" /
    // "New contacts" — see ImportOutcome.tsx.
    await expect(page.locator('text=/Contactos nuevos|New contacts/i')).toBeVisible();

    // 3. Visible in the table view (/contacts, default layout).
    await gotoAuthed(page, `/contacts?q=${encodeURIComponent(contactName!)}`);
    await expect(page.locator(`text=${contactName}`)).toBeVisible();

    // 4. Visible in the board view (?layout=board) — task 14.1. A brand-new
    // import has no logged activity yet, so `deriveStatus` places it in the
    // "Nuevo" column.
    await gotoAuthed(page, `/contacts?layout=board&q=${encodeURIComponent(contactName!)}`);
    await expect(page.locator(`text=${contactName}`)).toBeVisible();
  });
});
