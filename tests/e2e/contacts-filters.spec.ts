import { test, expect, type Page } from '@playwright/test';
import { gotoAuthed, skipWithoutCredentials } from './helpers';

skipWithoutCredentials();

/**
 * Regression guard for the /contacts "Agregar filtro" menu.
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
  const empty = page.getByText('Ningún contacto coincide con esta vista.');
  await expect(footer.or(empty)).toBeVisible();
  if (await empty.isVisible()) return 0;
  const text = (await footer.textContent()) ?? '';
  const match = text.match(/de\s+(\d+)/);
  expect(match, `Could not read the total from footer text: "${text}"`).not.toBeNull();
  return Number(match![1]);
}

/** Opens "Agregar filtro" and picks one entry; returns that filter's editor form. */
async function openEditorFromMenu(page: Page, field: string) {
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByRole('button', { name: field, exact: true }).click();
  const editor = page.locator('form.menu').filter({ hasText: field });
  await expect(editor).toBeVisible();
  return editor;
}

/** Submits an editor (a GET form) and waits for the page to settle on the result. */
async function applyEditor(page: Page, editor: ReturnType<Page['locator']>) {
  // The list URL already carries a query string, so wait for it to CHANGE.
  const from = page.url();
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/contacts' && url.href !== from),
    editor.getByRole('button', { name: 'Aplicar filtros', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
}

const chip = (page: Page, label: string) => page.locator('.chip-target', { hasText: label });

test.describe('Contacts: "Agregar filtro" regressions', () => {
  test('"Tiene teléfono" applies: chip appears and the total strictly decreases', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);
    expect(before, 'Needs at least one contact in the list').toBeGreaterThan(0);

    const editor = await openEditorFromMenu(page, 'Tiene teléfono');
    await editor.getByRole('checkbox', { name: 'Tiene teléfono' }).check();
    await applyEditor(page, editor);

    await expect(chip(page, 'Tiene teléfono')).toBeVisible();
    const after = await totalOf(page);
    expect(after).toBeLessThan(before);

    // Every visible row has a phone: no "Sin teléfono" badge in the table.
    await expect(page.locator('tbody .badge-none', { hasText: 'Sin teléfono' })).toHaveCount(0);
  });

  test('unchecking "Tiene teléfono" removes the chip and restores the total', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);

    const first = await openEditorFromMenu(page, 'Tiene teléfono');
    await first.getByRole('checkbox', { name: 'Tiene teléfono' }).check();
    await applyEditor(page, first);
    await expect(chip(page, 'Tiene teléfono')).toBeVisible();
    expect(await totalOf(page)).toBeLessThan(before);

    // Reopen the editor from the chip itself, uncheck, apply.
    await chip(page, 'Tiene teléfono').click();
    const reopened = page.locator('form.menu').filter({ hasText: 'Tiene teléfono' });
    const box = reopened.getByRole('checkbox', { name: 'Tiene teléfono' });
    await expect(box).toBeChecked();
    await box.uncheck();
    await applyEditor(page, reopened);

    await expect(chip(page, 'Tiene teléfono')).toHaveCount(0);
    expect(await totalOf(page)).toBe(before);
  });

  test('"Tipo de contacto" is in the menu and "Comprador / promotor" narrows the list', async ({ page }) => {
    await gotoAuthed(page, LIST_URL);
    const before = await totalOf(page);
    expect(before, 'Needs at least one contact in the list').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tipo de contacto', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tipo de contacto', exact: true }).click();

    const editor = page.locator('form.menu').filter({ hasText: 'Tipo de contacto' });
    await editor.getByRole('combobox').selectOption({ label: 'Comprador / promotor' });
    await applyEditor(page, editor);

    await expect(chip(page, 'Tipo de contacto')).toBeVisible();
    expect(await totalOf(page)).toBeLessThan(before);
  });
});
