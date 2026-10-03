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
  expect((await activitiesFor(p.id)).map((a) => a.type)).toEqual(['note']);
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

test('the follow-up task failing to save is reported, not hidden behind "Nota guardada"', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-NOTE-PARTIAL: NoteComposer.tsx ignores the task result and has no try/finally');
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
  await page.waitForTimeout(3000);
  await page.unroute('**/contacts/**');
  const notes = (await activitiesFor(p.id)).filter((a) => a.type === 'note').length;
  const tasks = (await tasksFor(p.id)).length;
  console.log(`[note-partial] notes=${notes} tasks=${tasks} textareaDisabled=${await page.locator('#note-in').isDisabled()} textareaValue=${JSON.stringify(await page.locator('#note-in').inputValue())}`);
  // Healthy behavior: either both saved, or the BD can see what was not and can retry without duplicating the note.
  expect(await page.locator('#note-in').isDisabled(), 'composer frozen after the second write failed').toBe(false);
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
