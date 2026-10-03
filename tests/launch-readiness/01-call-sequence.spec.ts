/**
 * The owner's real path (single user, call-first): pick a contact from a
 * filtered list, call it, log the call, come back to the list. The seams
 * between steps are what is under test: does the contact visibly leave the
 * "to call" view, do filters survive a refresh, does the status refresh.
 */
import { expect, test, type Page } from '@playwright/test';
import { activitiesFor, meId, openQuickAction, personStatus, sql } from './helpers';

test.describe.configure({ mode: 'serial' });

async function addHasPhoneFilter(page: Page) {
  await page.locator('button.chip-add').click();
  await page.locator('button', { hasText: 'Tiene teléfono' }).click();
  await page.getByRole('checkbox', { name: 'Tiene teléfono' }).check();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await page.waitForURL(/hasPhone/);
  await page.waitForLoadState('networkidle');
}

async function tabCount(page: Page, tab: string): Promise<number> {
  const text = await page.getByRole('link', { name: new RegExp(`^${tab}\\s*\\d+`) }).innerText();
  return Number(text.replace(/\D+/g, ' ').trim().split(' ').pop());
}

test.describe('log a call from the to-call list', () => {
  let personId = '';
  let personName = '';
  let toCallBefore = 0;

  test('pick the first contact of the filtered "Sin contactar" list', async ({ page }) => {
    await page.goto('/contacts');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /^Sin contactar/ }).click();
    await page.waitForURL(/view=notContacted/);
    await addHasPhoneFilter(page);
    toCallBefore = await tabCount(page, 'Sin contactar');

    const firstLink = page.locator('tbody a[href^="/contacts/"]').first();
    const href = (await firstLink.getAttribute('href'))!;
    personId = href.split('/').pop()!;
    personName = (await firstLink.innerText()).split('\n')[0]!.trim();
    await firstLink.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByRole('heading', { name: personName })).toBeVisible();
  });

  test('log a "Sin respuesta" call with notes; timeline, status and DB agree', async ({ page }) => {
    await page.goto(`/contacts/${personId}`);
    const dlg = await openQuickAction(page, 'call');
    await dlg.getByLabel('Resultado').selectOption('no_answer');
    await dlg.getByLabel('Notas').fill('No contestó. Reintentar mañana por la tarde.');
    await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
    await expect(page.getByText('Llamada registrada.')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();

    // UI: the timeline shows the call and the status badge moved.
    await expect(page.getByText('No contestó. Reintentar mañana por la tarde.')).toBeVisible();
    await expect(page.locator('.quick-actions').locator('xpath=..').getByText('Contactado').first()).toBeVisible();

    // DB: one call activity, logged by the e2e BD, outbound, correct outcome.
    const acts = await activitiesFor(personId);
    expect(acts.map((a) => a.type)).toEqual(['call']);
    expect(acts[0]!.actor_bd_id).toBe(await meId());
    expect(acts[0]!.metadata).toMatchObject({ outcome: 'no_answer', direction: 'outbound' });
    expect(await personStatus(personId)).toBe('contacted');
  });

  test('coming back to the list by navigation, the contact has left "Sin contactar"', async ({ page }) => {
    await page.goto(`/contacts/${personId}`);
    await page.waitForLoadState('networkidle');
    // Client-side navigation (sidebar link), the way a BD moves between pages.
    await page.getByRole('link', { name: 'Contactos', exact: true }).first().click();
    await page.waitForURL('**/contacts');
    await page.getByRole('link', { name: /^Sin contactar/ }).click();
    await page.waitForURL(/view=notContacted/);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tbody').getByText(personName)).toHaveCount(0);
    expect(await tabCount(page, 'Sin contactar')).toBe(toCallBefore - 1);
  });

  test('the browser Back button does not resurrect the contact in "Sin contactar"', async ({ page }) => {
    await page.goto('/contacts?view=notContacted&hasPhone=1');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tbody').getByText(personName)).toHaveCount(0);
    await page.goto(`/contacts/${personId}`);
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tbody').getByText(personName)).toHaveCount(0);
  });

  test('filters survive a refresh and the contact shows as Contactado under "Todos"', async ({ page }) => {
    await page.goto('/contacts?view=all&hasPhone=1');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    const row = page.locator('tbody tr', { hasText: personName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Contactado');
    await expect(page.getByText('Tiene teléfono', { exact: false }).first()).toBeVisible();
  });

  test('a just-called contact is not due in Seguimientos yet', async ({ page }) => {
    await page.goto('/follow-ups');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(personName)).toHaveCount(0);
  });

  test.afterAll(async () => {
    await sql.end();
  });
});
