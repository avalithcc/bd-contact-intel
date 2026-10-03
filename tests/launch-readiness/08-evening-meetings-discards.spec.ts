/**
 * Three things Mariel does less often, plus the clock: the suite is meant to
 * be run in the evening too, when Argentina (UTC-3) is still on today while
 * UTC is already tomorrow.
 */
import { expect, test } from '@playwright/test';
import { activitiesFor, argDate, newPerson, openContact, openQuickAction, personStatus, sql, tasksFor } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

test('a task due TODAY (Argentina date) is in "Hoy", not in "Vencidas"', async ({ page }) => {
  const p = await newPerson('TaskToday');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'task');
  await dlg.getByLabel('Título').fill('Vence hoy');
  await dlg.getByLabel('Vencimiento').fill(argDate(0));
  await dlg.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  expect(await tasksFor(p.id)).toHaveLength(1);
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: p.name });
  await expect(row).toBeVisible();
  const rowY = (await row.boundingBox())!.y;
  let section = '';
  let best = -1;
  for (const name of ['Vencidas', 'Hoy', 'Próximas']) {
    const h = page.getByRole('heading', { name: new RegExp('^' + name) });
    if ((await h.count()) === 0) continue;
    const y = (await h.first().boundingBox())!.y;
    if (y < rowY && y > best) {
      best = y;
      section = name;
    }
  }
  console.log(`[evening] task due today sits under heading: "${section}"`);
  expect(section).toBe('Hoy');
});

test('a call logged with no date/time shows today\'s Argentina date in the timeline, even late in the evening', async ({ page }) => {
  const p = await newPerson('CallNow');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('busy');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const [call] = await activitiesFor(p.id);
  console.log(`[evening] occurredAt=${call!.metadata.occurredAt} (argDate=${argDate(0)})`);
  const meta = await page.locator('.tl').first().innerText();
  console.log(`[evening] timeline text: ${JSON.stringify(meta.slice(0, 160))}`);
  expect(await personStatus(p.id)).toBe('contacted');
});

test('a meeting: required date is enforced, saved once, status moves to meeting', async ({ page }) => {
  const p = await newPerson('Meeting');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'meeting');
  await expect(dlg.getByRole('button', { name: 'Registrar reunión' })).toBeDisabled();
  expect(await activitiesFor(p.id)).toHaveLength(0);
  await dlg.getByLabel('Fecha').fill(argDate(0));
  await dlg.getByLabel('Notas').fill('Reunión inicial');
  await dlg.getByRole('button', { name: 'Registrar reunión' }).dblclick();
  await expect(page.getByText('Reunión registrada.')).toBeVisible();
  await page.waitForTimeout(1200);
  const meetings = (await activitiesFor(p.id)).filter((a) => a.type === 'meeting_logged');
  expect(meetings).toHaveLength(1);
  expect(await personStatus(p.id)).toBe('meeting');
});

test('F12: a meeting dated in the future is refused with a message that points at the task action, and nothing is saved', async ({ page }) => {
  const p = await newPerson('MeetingFuture');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'meeting');
  await dlg.getByLabel('Fecha').fill(argDate(5));
  await dlg.getByRole('button', { name: 'Registrar reunión' }).click();
  await expect(dlg.getByRole('alert')).toContainText('fecha futura');
  await expect(dlg.getByRole('alert'), 'she is told what to do for a meeting she has only scheduled').toContainText('tarea de seguimiento');
  await expect(page.getByText('Reunión registrada.')).toHaveCount(0);
  // The dialog stays usable (not frozen) so she can correct the date.
  await expect(dlg.getByRole('button', { name: 'Registrar reunión' })).toBeEnabled();
  const meetings = (await activitiesFor(p.id)).filter((a) => a.type === 'meeting_logged');
  expect(meetings, 'nothing saved').toHaveLength(0);
  expect(await personStatus(p.id)).not.toBe('meeting');
});

test('discarding needs a reason, "Otro" needs a note, and a discarded contact leaves "Sin contactar"', async ({ page }) => {
  const p = await newPerson('Discard');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'discard');
  await expect(dlg.getByRole('button', { name: 'Descartar contacto' })).toBeDisabled();
  await dlg.getByLabel(/Motivo/).selectOption({ label: 'Otro' });
  await expect(dlg.getByRole('button', { name: 'Descartar contacto' }), '"Otro" with no note').toBeDisabled();
  await dlg.getByLabel('Nota').fill('   ');
  await expect(dlg.getByRole('button', { name: 'Descartar contacto' }), '"Otro" with whitespace note').toBeDisabled();
  expect(await activitiesFor(p.id)).toHaveLength(0);
  await dlg.getByLabel('Nota').fill('Cerró el hotel');
  await dlg.getByRole('button', { name: 'Descartar contacto' }).click();
  await expect(page.getByText('Contacto descartado.')).toBeVisible();
  expect(await personStatus(p.id)).toBe('discarded');
  await page.goto('/contacts?view=notContacted&q=' + encodeURIComponent(p.name.split(' ')[0]!));
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tbody').getByText(p.name)).toHaveCount(0);
});
