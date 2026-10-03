/**
 * The note box on the record, with its "Agregar tarea de seguimiento" button:
 * the quickest way Mariel can leave "call me back" behind. It is two writes
 * (note, then task) from the browser, so the seam between them matters.
 */
import { expect, test } from '@playwright/test';
import { activitiesFor, newPerson, openContact, personStatus, sql, tasksFor } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

test('note + follow-up task: both saved, the task has no due date, and it shows up on /tasks', async ({ page }) => {
  const p = await newPerson('NoteTask');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Pidió que lo llame el lunes.');
  await page.getByRole('button', { name: 'Agregar tarea de seguimiento' }).click();
  await page.getByPlaceholder('Agregar tarea de seguimiento').fill('Llamar el lunes');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.getByText('Nota guardada.')).toBeVisible();
  await expect.poll(async () => (await tasksFor(p.id)).length).toBe(1);
  const [t] = await tasksFor(p.id);
  console.log(`[note+task] due_at=${t!.due_at} assigned=${t!.assigned_to_bd_id}`);
  expect((await activitiesFor(p.id)).map((a) => a.type)).toEqual(['note', 'task_created']);
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tr', { hasText: p.name }), 'a follow-up with no date is not on /tasks').toBeVisible();
});

test('a note alone does not make the contact "contacted" (it stays in Sin contactar)', async ({ page }) => {
  const p = await newPerson('NoteOnly');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Investigué el hotel antes de llamar.');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.getByText('Nota guardada.')).toBeVisible();
  console.log(`[note] status after a note only: ${await personStatus(p.id)}`);
  expect(await personStatus(p.id)).toBe('new');
});

test('the follow-up task failing to save is reported, the note is not duplicated, and the follow-up can be retried alone', async ({ page }) => {
  const p = await newPerson('NotePartial');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Nota con tarea que va a fallar.');
  await page.getByRole('button', { name: 'Agregar tarea de seguimiento' }).click();
  await page.getByPlaceholder('Agregar tarea de seguimiento').fill('Tarea que falla');
  let posts = 0;
  await page.route('**/contacts/**', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    return posts === 2 ? route.abort('connectionfailed') : route.continue();
  });
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  const alert = page.locator('#log-note').getByRole('alert');
  await expect(alert, 'partial success is told, not hidden').toContainText('La nota se guardó');
  await expect(alert).toContainText('seguimiento');
  await expect(page.getByText('Nota guardada.'), 'no success toast for a half-done save').toHaveCount(0);
  await page.unroute('**/contacts/**');
  expect((await activitiesFor(p.id)).filter((a) => a.type === 'note')).toHaveLength(1);
  expect(await tasksFor(p.id)).toHaveLength(0);
  // The note text is gone (it is saved); only the follow-up is retryable.
  await expect(page.locator('#note-in')).toHaveValue('');
  await expect(page.getByPlaceholder('Agregar tarea de seguimiento')).toHaveValue('Tarea que falla');
  await page.getByRole('button', { name: 'Reintentar seguimiento' }).click();
  await expect(page.getByText('Nota guardada.')).toBeVisible();
  await expect.poll(async () => (await tasksFor(p.id)).length).toBe(1);
  expect((await activitiesFor(p.id)).filter((a) => a.type === 'note'), 'the retry must not write the note again').toHaveLength(1);
});

test('the follow-up task answering {ok:false} (not throwing) is reported the same way', async ({ page }) => {
  const p = await newPerson('NoteTaskRefused');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Nota cuya tarea es rechazada.');
  await page.getByRole('button', { name: 'Agregar tarea de seguimiento' }).click();
  await page.getByPlaceholder('Agregar tarea de seguimiento').fill('Tarea rechazada');
  let posts = 0;
  await page.route('**/contacts/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    if (posts !== 2) return route.continue();
    // Run the real action, then rewrite its flight payload to the failure
    // shape ({ ok: false, reason }). This exercises the browser's handling of
    // a normal-but-failed response; the server did write the task here, so
    // only the UI side is asserted below.
    const real = await route.fetch();
    const body = (await real.text()).replace('{"ok":true}', '{"ok":false,"reason":"unexpected"}');
    return route.fulfill({ response: real, body });
  });
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.locator('#log-note').getByRole('alert')).toContainText('La nota se guardó, pero el seguimiento no.');
  await expect(page.getByText('Nota guardada.')).toHaveCount(0);
  await page.unroute('**/contacts/**');
  await expect(page.getByRole('button', { name: 'Reintentar seguimiento' })).toBeEnabled();
  expect((await activitiesFor(p.id)).filter((a) => a.type === 'note')).toHaveLength(1);
});

test('a note that fails to save keeps its text and the composer usable', async ({ page }) => {
  const p = await newPerson('NoteFails');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Esta nota no llega.');
  await page.route('**/contacts/**', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.locator('#log-note').getByRole('alert')).toContainText('No se pudo confirmar que se guardó');
  await page.unroute('**/contacts/**');
  await expect(page.locator('#note-in')).toHaveValue('Esta nota no llega.');
  await expect(page.locator('#note-in')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Guardar nota' })).toBeEnabled();
});

test('an unconfirmed note that DID land shows in the timeline without a reload', async ({ page }) => {
  const p = await newPerson('NoteLandedUnconfirmed');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Nota que llegó igual.');
  await page.route('**/contacts/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    return route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(page.locator('#log-note').getByRole('alert')).toContainText('No se pudo confirmar que se guardó');
  await page.unroute('**/contacts/**');
  await expect(page.getByText('Nota que llegó igual.').first(), 'the timeline must refresh after an unconfirmed result').toBeVisible();
});

test('double-clicking "Guardar nota" saves ONE note', async ({ page }) => {
  const p = await newPerson('NoteDouble');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('Doble clic');
  await page.getByRole('button', { name: 'Guardar nota' }).dblclick();
  await expect(page.getByText('Nota guardada.')).toBeVisible();
  await page.waitForTimeout(1200);
  expect((await activitiesFor(p.id)).filter((a) => a.type === 'note')).toHaveLength(1);
});

test('whitespace-only note: the save button stays disabled and nothing is stored', async ({ page }) => {
  const p = await newPerson('NoteBlank');
  await openContact(page, p.id);
  await page.locator('#note-in').fill('   \n  ');
  await expect(page.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
  expect(await activitiesFor(p.id)).toHaveLength(0);
});
