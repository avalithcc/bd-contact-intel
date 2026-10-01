import { test, expect } from '@playwright/test';
import { gotoAuthed, openFirstContactOrSkip, openFirstOrSkip, skipWithoutCredentials } from './helpers';
// Every label below comes from the Spanish dictionary, never from memory or a
// component comment: a translation change then breaks the build (typecheck)
// instead of silently rotting the spec.
import { es } from '../../src/lib/i18n/dictionaries/es';
import { BOARD_COLUMNS } from '../../src/lib/contacts/board';

skipWithoutCredentials();

// STRICTLY READ-ONLY: this suite runs against production. Specs here navigate,
// open dialogs/inline editors and type into fields, but never press a save /
// create / send button.

test.describe('Phase 1: Core CRM Tracking', () => {
  test('Tasks page lists tasks with a complete control', async ({ page }) => {
    await gotoAuthed(page, '/tasks');
    await expect(page.locator('main h1').first()).toContainText(new RegExp(es.tasksPage.title, 'i'));

    // The default view ("mine") is per BD, so a fresh account has none: an
    // empty list must say so, not quietly pass as if it had rendered tasks.
    const rows = page.locator('main tbody tr');
    if ((await rows.count()) === 0) {
      await expect(page.getByText(es.tasksPage.emptyState)).toBeVisible();
      return;
    }
    // The complete control is a checkbox. Only assert it; never tick it (that completes a real task).
    await expect(rows.first().getByRole('checkbox', { name: es.tasksPage.completeAria })).toBeVisible();
  });

  test('Tasks page "all open" view renders rows with a complete control', async ({ page }) => {
    // The default view is per BD and empty for a fresh account; the shared
    // "Todas abiertas" view exercises the populated branch.
    await gotoAuthed(page, '/tasks?view=all');
    const rows = page.locator('main tbody tr');
    if ((await rows.count()) === 0) {
      await expect(page.getByText(es.tasksPage.emptyStateAll)).toBeVisible();
      return;
    }
    await expect(rows.first().getByRole('checkbox', { name: es.tasksPage.completeAria })).toBeVisible();
  });

  test('Kanban board renders every pipeline column', async ({ page }) => {
    // /leads?view=board now redirects here; go straight to the canonical URL.
    await gotoAuthed(page, '/contacts?view=all&layout=board');

    expect(BOARD_COLUMNS.length).toBeGreaterThan(0);
    for (const status of BOARD_COLUMNS) {
      const column = page.locator(`section.board-col[data-board-status="${status}"]`);
      await expect(column).toBeVisible();
      await expect(column.locator('.col-header .badge')).toHaveText(es.leadStatuses[status]);
    }
  });

  test('Contact record shows the activity timeline and the task and signal quick actions', async ({ page }) => {
    const result = await openFirstContactOrSkip(page);
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await expect(page.getByRole('tab', { name: es.contactRecord.tabActivity, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: es.contactRecord.quickActionTask, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: es.contactRecord.quickActionSignal, exact: true })).toBeVisible();
  });

  test('Task quick action opens a titled form', async ({ page }) => {
    const result = await openFirstContactOrSkip(page);
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.getByRole('button', { name: es.contactRecord.quickActionTask, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const title = dialog.getByLabel(es.contactRecord.taskTitleLabel, { exact: true });
    await expect(title).toBeVisible();
    await title.fill('Follow up next week');
    await expect(title).toHaveValue('Follow up next week');
    // Never submit: close without saving.
    await dialog.getByRole('button', { name: es.contactRecord.cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Signal paste accepts and retains input', async ({ page }) => {
    const result = await openFirstContactOrSkip(page);
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.getByRole('button', { name: es.contactRecord.quickActionSignal, exact: true }).click();
    const textarea = page.getByPlaceholder(es.contactRecord.signalPlaceholder);
    await expect(textarea).toBeVisible();
    await textarea.fill('Saw they opened a Buenos Aires engineering hub.');
    await expect(textarea).toHaveValue(/Buenos Aires/);
    // Never submit ("Guardar señal"): leave the page with the text unsaved.
  });

  test('Companies page lists companies', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    await expect(page.locator('main h1').first()).toBeVisible();
  });

  test('Company detail exposes the edit and note controls', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    // Editing moved from a modal to per-property inline editors (pencil,
    // aria-label "Editar"); "add activity" became the "Nota" quick action.
    await expect(page.getByRole('button', { name: es.companyRecord.edit, exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: es.companyRecord.quickActionNote, exact: true })).toBeVisible();
  });

  test('Inline stage editor opens prefilled with the current stage', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    // Deviation from the old "Edit company modal" spec: that modal no longer
    // exists and the name is not editable. The surviving edit surface that
    // can wipe data on save is the inline editor; its prefill is the point.
    const prop = page.locator('.prop').filter({ has: page.locator('dt', { hasText: es.companyRecord.propStage }) });
    const current = (await prop.locator('.badge').first().innerText()).trim();
    await prop.getByRole('button', { name: es.companyRecord.edit, exact: true }).click();

    const select = prop.locator('select');
    await expect(select).toBeVisible();
    // A company with no stage falls back to the first option (Prospecto).
    const expected = current === es.companyRecord.emptyValue ? es.companiesPage.stageProspect : current;
    await expect(select.locator('option:checked')).toHaveText(expected);
    // Never save: cancel the editor.
    await prop.getByRole('button', { name: es.companyRecord.cancel, exact: true }).click();
    await expect(select).toHaveCount(0);
  });

  test('Note dialog opens with a note field', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.getByRole('button', { name: es.companyRecord.quickActionNote, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: es.companyRecord.noteDialogTitle });
    const note = dialog.getByLabel(es.companyRecord.noteLabel, { exact: true });
    await expect(note).toBeVisible();

    // The save guard: empty note cannot be submitted, typed note can. Typing
    // is local state only; the save button is never pressed.
    const save = dialog.getByRole('button', { name: es.companyRecord.noteSave, exact: true });
    await expect(save).toBeDisabled();
    await note.fill('draft that is never saved');
    await expect(save).toBeEnabled();
    await dialog.getByRole('button', { name: es.companyRecord.cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});
