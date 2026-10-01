import { test, expect, type Page } from '@playwright/test';
import { gotoAuthed, skipWithoutCredentials } from './helpers';
// Every label below comes from the dictionary, never from memory or a
// component comment: a translation change then breaks the build (typecheck)
// instead of silently rotting the spec. This spec learned that the hard way —
// its first version looked for "Agregar filtro", the name FilterMenu.tsx's
// header comment uses, while the button actually renders `filtersPanelLabel`
// ("Filtros"). All three tests timed out on a button that does not exist.
import { es } from '../../src/lib/i18n/dictionaries/es';
import { FILTER_FIELD_LABEL } from '../../src/lib/contacts/filterChips';
import { CONTACT_TYPE_LABELS } from '../../src/lib/contacts/contactType';

const L = es.contactList;

skipWithoutCredentials();

/**
 * Regression guard for the /contacts filter menu (the "Filtros" button).
 *
 * WARNING: this runs against whatever database `DATABASE_URL` points at, which
 * for this project is PRODUCTION. It is therefore strictly READ-ONLY: it only
 * navigates, opens menus and submits the filter editors (plain GET forms that
 * change the query string). It never saves a view, edits a contact or submits
 * anything that writes. Keep it that way.
 *
 * Totals are asserted RELATIVELY (before vs after), never as fixed numbers,
 * because production data drifts.
 *
 * Bugs covered:
 *  1. "Tiene teléfono" did nothing when applied (chip missing / total unchanged).
 *  2. Unchecking a checkbox filter did not clear a value inherited from a view
 *     (the editor submits `<field>__set=1` so "unchecked" is distinguishable
 *     from "never submitted").
 *  3. "Tipo de contacto" must exist in the menu and narrow the list.
 */

// `columns=phone` makes the phone column visible so the "Sin teléfono" badge
// assertion is meaningful (it is not in the default column set).
const LIST_URL = '/contacts?columns=phone';

/** Reads N from the footer's "Mostrando X–Y de N", or 0 on the empty state. */
async function totalOf(page: Page): Promise<number> {
  const footer = page.locator('.table-footer span').first();
  const empty = page.getByText(L.noResults);
  await expect(footer.or(empty)).toBeVisible();
  if (await empty.isVisible()) return 0;
  const text = (await footer.textContent()) ?? '';
  const match = text.match(/de\s+(\d+)/);
  expect(match, `Could not read the total from footer text: "${text}"`).not.toBeNull();
  return Number(match![1]);
}

/** Opens the filter menu and picks one entry; returns that filter's editor form. */
async function openEditorFromMenu(page: Page, field: string) {
  await page.getByRole('button', { name: L.filtersPanelLabel, exact: true }).click();
  await page.getByRole('button', { name: field, exact: true }).click();
  // `form.menu` alone is ambiguous: the column picker is also a `.menu` form
  // and lists column names that collide with filter names ("Responsable",
  // "Estado", "Empresa", "Industria"...). The filter editors are the GET
  // forms; the picker posts. Without this the helper hits a strict-mode
  // violation for any field that is also a column.
  const editor = page.locator('form.menu[method="get"]').filter({ hasText: field });
  await expect(editor).toBeVisible();
  return editor;
}

/** Submits an editor (a GET form) and waits for the page to settle on the result. */
async function applyEditor(page: Page, editor: ReturnType<Page['locator']>) {
  // The list URL already carries a query string, so wait for it to CHANGE.
  const from = page.url();
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/contacts' && url.href !== from),
    editor.getByRole('button', { name: L.filtersApply, exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
}

const chip = (page: Page, label: string) => page.locator('.chip-target', { hasText: label });

test.describe('Contacts: filter menu regressions', () => {
  test('"Tiene teléfono" applies: chip appears and the total strictly decreases', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);
    expect(before, 'Needs at least one contact in the list').toBeGreaterThan(0);

    const editor = await openEditorFromMenu(page, FILTER_FIELD_LABEL.hasPhone);
    await editor.getByRole('checkbox', { name: FILTER_FIELD_LABEL.hasPhone }).check();
    await applyEditor(page, editor);

    await expect(chip(page, FILTER_FIELD_LABEL.hasPhone)).toBeVisible();
    const after = await totalOf(page);
    expect(after).toBeLessThan(before);

    // Every visible row has a phone: no "Sin teléfono" badge in the table.
    await expect(page.locator('tbody .badge-none', { hasText: L.phoneNone })).toHaveCount(0);
  });

  test('unchecking "Tiene teléfono" removes the chip and restores the total', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);

    const first = await openEditorFromMenu(page, FILTER_FIELD_LABEL.hasPhone);
    await first.getByRole('checkbox', { name: FILTER_FIELD_LABEL.hasPhone }).check();
    await applyEditor(page, first);
    await expect(chip(page, FILTER_FIELD_LABEL.hasPhone)).toBeVisible();
    expect(await totalOf(page)).toBeLessThan(before);

    // Reopen the editor from the chip itself, uncheck, apply.
    await chip(page, FILTER_FIELD_LABEL.hasPhone).click();
    const reopened = page.locator('form.menu').filter({ hasText: FILTER_FIELD_LABEL.hasPhone });
    const box = reopened.getByRole('checkbox', { name: FILTER_FIELD_LABEL.hasPhone });
    await expect(box).toBeChecked();
    await box.uncheck();
    await applyEditor(page, reopened);

    await expect(chip(page, FILTER_FIELD_LABEL.hasPhone)).toHaveCount(0);
    expect(await totalOf(page)).toBe(before);
  });

  test('"Tipo de contacto" is in the menu and "Comprador / promotor" narrows the list', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);
    expect(before, 'Needs at least one contact in the list').toBeGreaterThan(0);

    await page.getByRole('button', { name: L.filtersPanelLabel, exact: true }).click();
    await expect(page.getByRole('button', { name: FILTER_FIELD_LABEL.contactType, exact: true })).toBeVisible();
    await page.getByRole('button', { name: FILTER_FIELD_LABEL.contactType, exact: true }).click();

    const editor = page.locator('form.menu').filter({ hasText: FILTER_FIELD_LABEL.contactType });
    await editor.getByRole('combobox').selectOption({ label: CONTACT_TYPE_LABELS['BUYER-CHAMPION'] });
    await applyEditor(page, editor);

    await expect(chip(page, FILTER_FIELD_LABEL.contactType)).toBeVisible();
    expect(await totalOf(page)).toBeLessThan(before);
  });

  /**
   * The owner's ACTUAL report was the combination, not the filter alone:
   * "filtrar contactos x responsable y a su vez, que tengan telefono... pero
   * trae gente sin telefono". The two filters are ANDed in
   * `baseContactFilterConditions`; this guards that they still compose.
   *
   * The BD is picked by uuid-shaped value rather than by name, so a staffing
   * change cannot rot this spec. The e2e bot account is skipped: it owns
   * nothing, so it would make the assertion pass trivially.
   */
  test('responsable + "Tiene teléfono" compose: the combination narrows further', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);

    const ownerEditor = await openEditorFromMenu(page, FILTER_FIELD_LABEL.owner);
    const select = ownerEditor.locator('select');
    const realBdValue = await select.evaluate((el) => {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const opt = [...(el as HTMLSelectElement).options].find(
        (o) => uuid.test(o.value) && !/ZZ E2E/i.test(o.label),
      );
      return opt?.value ?? null;
    });
    test.skip(!realBdValue, 'No real BD in the Responsable options to filter by.');
    await select.selectOption(realBdValue!);
    await applyEditor(page, ownerEditor);

    const ownerOnly = await totalOf(page);
    expect(ownerOnly, 'That BD needs at least one contact for this to mean anything').toBeGreaterThan(0);

    const phoneEditor = await openEditorFromMenu(page, FILTER_FIELD_LABEL.hasPhone);
    await phoneEditor.getByRole('checkbox', { name: FILTER_FIELD_LABEL.hasPhone }).check();
    await applyEditor(page, phoneEditor);

    // Both chips survive the second submit — the bug was one filter dropping
    // the other on the way through the query string.
    await expect(chip(page, FILTER_FIELD_LABEL.owner)).toBeVisible();
    await expect(chip(page, FILTER_FIELD_LABEL.hasPhone)).toBeVisible();

    const both = await totalOf(page);
    expect(both).toBeLessThan(ownerOnly);
    await expect(page.locator('tbody .badge-none', { hasText: L.phoneNone })).toHaveCount(0);
  });
});
