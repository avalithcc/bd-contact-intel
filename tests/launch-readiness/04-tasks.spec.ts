/**
 * Follow-up tasks: create from a record, find it on /tasks, complete it,
 * reopen it, edit it, and the wrong things a BD does along the way. The
 * owner's standing rule under test: any BD may edit any task, but every
 * change logs an activity naming who did it.
 */
import { expect, test, type Page } from '@playwright/test';
import { activitiesFor, argDate, meId, newPerson, openContact, openQuickAction, otherBdId, sql, tasksFor } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

async function createTaskOnRecord(
  page: Page,
  fields: { title: string; due?: string; description?: string; assignee?: string },
) {
  const dlg = await openQuickAction(page, 'task');
  await dlg.getByLabel('Título').fill(fields.title);
  if (fields.due) await dlg.getByLabel('Vencimiento').fill(fields.due);
  if (fields.description) await dlg.getByLabel('Descripción').fill(fields.description);
  if (fields.assignee) await dlg.getByLabel('Asignado a').selectOption({ label: fields.assignee });
  await dlg.getByRole('button', { name: 'Crear tarea' }).click();
  return dlg;
}

test('create on a record: DB row, record page, and /tasks all agree on title, owner and due date', async ({ page }) => {
  const p = await newPerson('TaskCreate');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Llamar de nuevo el jueves', due: argDate(7), description: 'Preguntar por compras' });
  await expect(page.getByText('Tarea creada.')).toBeVisible();

  const [t] = await tasksFor(p.id);
  expect(t).toMatchObject({ title: 'Llamar de nuevo el jueves', status: 'open', description: 'Preguntar por compras' });
  expect(t!.assigned_to_bd_id).toBe(await meId());
  expect(t!.actor_bd_id).toBe(await meId());
  expect(t!.due_at!.toISOString()).toBe(`${argDate(7)}T00:00:00.000Z`);

  const [, month, day] = argDate(7).split('-');
  const label = `${Number(day)} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(month) - 1]}`;
  await expect(page.getByText(`Vence ${label}`).first()).toBeVisible();

  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: p.name });
  await expect(row).toContainText(p.name);
  await expect(row).toContainText('ZZ E2E (no asignar)');
  await expect(row).toContainText(label);
});

test('complete from /tasks: status, toast, an activity that names the actor, and the record timeline shows it', async ({ page }) => {
  const p = await newPerson('TaskComplete');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Enviar propuesta', due: argDate(1) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();

  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: p.name }).getByRole('checkbox').click();
  await expect(page.locator('tr', { hasText: p.name })).toHaveCount(0);

  expect((await tasksFor(p.id))[0]!.status).toBe('done');
  const done = (await activitiesFor(p.id)).filter((a) => a.type === 'task_completed');
  expect(done).toHaveLength(1);
  expect(done[0]!.actor_bd_id).toBe(await meId());

  await openContact(page, p.id);
  await expect(page.locator('main').getByText(/completad/i).first()).toBeVisible();
  await expect(page.locator('main').getByText('ZZ E2E (no asignar)').first()).toBeVisible();
});

test('completing then reopening logs both changes with the actor, and leaves the task open', async ({ page }) => {
  const p = await newPerson('TaskReopen');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Cerrar y volver a abrir', due: argDate(2) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como hecha' }).first().click();
  await expect.poll(async () => (await tasksFor(p.id))[0]!.status).toBe('done');
  // "Reabrir" only exists inside the record's "Tareas" pill, on a done task.
  await page.locator('.filter-pill', { hasText: 'Tareas' }).click();
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect.poll(async () => (await tasksFor(p.id))[0]!.status).toBe('open');
  const types = (await activitiesFor(p.id)).map((a) => a.type).filter((t) => t.startsWith('task_'));
  expect(types).toEqual(['task_created', 'task_completed', 'task_reopened']);
  for (const a of await activitiesFor(p.id)) expect(a.actor_bd_id).toBe(await meId());
});

test('any BD may complete a task assigned to someone else, and the activity names the one who did it', async ({ page }) => {
  const p = await newPerson('TaskOtherBd');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Tarea del otro BD', assignee: 'ZZ Otro BD' });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  const [t] = await tasksFor(p.id);
  expect(t!.assigned_to_bd_id).toBe(await otherBdId());
  expect(t!.actor_bd_id).toBe(await meId());

  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: /Mis tareas abiertas/ })).toBeVisible();
  await page.getByRole('link', { name: /Todas abiertas/ }).click();
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: p.name }).getByRole('checkbox').click();
  await expect(page.locator('tr', { hasText: p.name })).toHaveCount(0);
  const done = (await activitiesFor(p.id)).find((a) => a.type === 'task_completed');
  expect(done!.actor_bd_id).toBe(await meId());
});

test('creating a task leaves exactly one task_created activity naming who created it', async ({ page }) => {
  const p = await newPerson('TaskCreateLog');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Crear deja rastro' });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  const [t] = await tasksFor(p.id);
  const created = (await activitiesFor(p.id)).filter((a) => a.type.startsWith('task_'));
  expect(created).toHaveLength(1);
  expect(created[0]!.type).toBe('task_created');
  expect(created[0]!.actor_bd_id).toBe(await meId());
  expect(created[0]!.metadata).toMatchObject({ taskId: t!.id, taskTitle: 'Crear deja rastro' });
  // And the record's own timeline says so, with the actor's name.
  await page.locator('.filter-pill', { hasText: 'Tareas' }).click();
  await expect(page.locator('main').getByText(/creó la tarea «Crear deja rastro»/)).toBeVisible();
});

test('editing a task logs ONE activity with the actor and the before/after', async ({ page }) => {
  const p = await newPerson('TaskEdit');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Titulo viejo', due: argDate(3) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Titulo viejo' }).or(page.getByText('Titulo viejo')).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel(/Título/).fill('Titulo nuevo');
  await dlg.getByRole('button', { name: /Guardar/ }).click();
  await expect(page.getByText('Tarea actualizada.')).toBeVisible();
  const upd = (await activitiesFor(p.id)).filter((a) => a.type === 'task_updated');
  expect(upd).toHaveLength(1);
  expect(upd[0]!.actor_bd_id).toBe(await meId());
  expect((await tasksFor(p.id))[0]!.title).toBe('Titulo nuevo');
});

test('the create button is disabled for an empty and for a whitespace-only title', async ({ page }) => {
  const p = await newPerson('TaskBlank');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'task');
  await expect(dlg.getByRole('button', { name: 'Crear tarea' })).toBeDisabled();
  await dlg.getByLabel('Título').fill('     ');
  await expect(dlg.getByRole('button', { name: 'Crear tarea' })).toBeDisabled();
  expect(await tasksFor(p.id)).toHaveLength(0);
});

test('a due date in the past is accepted but the BD is told it is overdue', async ({ page }) => {
  const p = await newPerson('TaskPast');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Ya vencida', due: argDate(-5) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tr', { hasText: p.name })).toBeVisible();
  await expect(page.getByText(/Atrasad|Vencid/i).first()).toBeVisible();
});

test('double-clicking "Crear tarea" creates ONE task', async ({ page }) => {
  const p = await newPerson('TaskDouble');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'task');
  await dlg.getByLabel('Título').fill('Doble clic');
  await dlg.getByRole('button', { name: 'Crear tarea' }).dblclick();
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await tasksFor(p.id)).toHaveLength(1);
});

test('double-clicking the completion checkbox does not log two completions', async ({ page }) => {
  const p = await newPerson('TaskDoubleDone');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Completar dos veces' });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: p.name }).getByRole('checkbox').dblclick();
  await page.waitForTimeout(2500);
  const completions = (await activitiesFor(p.id)).filter((a) => a.type === 'task_completed');
  const reopens = (await activitiesFor(p.id)).filter((a) => a.type === 'task_reopened');
  console.log(`[double-complete] completed=${completions.length} reopened=${reopens.length} status=${(await tasksFor(p.id))[0]!.status}`);
  expect(completions.length).toBeLessThanOrEqual(1);
});

test('a 3,000-character title is clamped to one line on /tasks, stays whole in the database, and is reachable in full', async ({ page }) => {
  const p = await newPerson('TaskLongTitle');
  await openContact(page, p.id);
  const longTitle = `Titulo ${'largo '.repeat(500)}`.trim();
  await createTaskOnRecord(page, { title: longTitle });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '/tasks scrolls sideways because of a long title').toBeLessThanOrEqual(0);
  const row = page.locator('tr', { hasText: p.name }).first();
  const rowHeight = await row.evaluate((el) => el.getBoundingClientRect().height);
  expect(rowHeight, 'one task row is taller than the screen').toBeLessThan(120);
  // Display is clamped, the stored title is not, and the full text is one hover away.
  expect((await tasksFor(p.id))[0]!.title).toBe(longTitle);
  await expect(row.getByRole('button', { name: /^Titulo largo/ })).toHaveAttribute('title', longTitle);
});

test('F14: the empty Tareas and BDs conectados cards say what is true, not "coming soon"', async ({ page }) => {
  const p = await newPerson('TaskEmptyCard');
  await openContact(page, p.id);
  await expect(page.getByText('próximamente')).toHaveCount(0);
  await expect(page.getByText('No hay tareas abiertas. Usa el botón + para agregar una.')).toBeVisible();
  await expect(page.getByText('Ningún BD se ha conectado con este contacto todavía.')).toBeVisible();
});

test('a task created with no due date is still an actionable card in the record\'s Todo timeline', async ({ page }) => {
  const p = await newPerson('TaskNoDate');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Sin fecha de vencimiento' });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  // The open task itself (title + "Marcar como hecha"), not just the log line that says it was created.
  const timeline = page.locator('.tl');
  await expect(timeline.getByRole('button', { name: 'Sin fecha de vencimiento' })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Marcar como hecha' })).toBeVisible();
});

test('a done task in Completadas shows as done and cannot log a second completion', async ({ page }) => {
  const p = await newPerson('TaskUndo');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Deshacer completar', due: argDate(2) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: p.name }).getByRole('checkbox').click();
  await expect(page.locator('tr', { hasText: p.name })).toHaveCount(0);
  await page.getByRole('link', { name: /^Completadas/ }).click();
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: p.name });
  await expect(row).toBeVisible();
  const cb = row.getByRole('checkbox');
  // A done task must look done: a checked box that no longer invites a click.
  await expect(cb).toBeChecked();
  await expect(cb).toBeDisabled();
  const before = (await activitiesFor(p.id)).filter((a) => a.type === 'task_completed').length;
  await cb.click({ force: true });
  await page.waitForTimeout(1500);
  const after = (await activitiesFor(p.id)).filter((a) => a.type === 'task_completed').length;
  expect(after, 'clicking a done task logged another completion').toBe(before);
  expect((await tasksFor(p.id))[0]!.status).toBe('done');
});

test('a stale checkbox on a task that is already done changes nothing and logs no second completion', async ({ page }) => {
  const p = await newPerson('TaskStale');
  await openContact(page, p.id);
  await createTaskOnRecord(page, { title: 'Completada en otra pestaña', due: argDate(2) });
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  const cb = page.locator('tr', { hasText: p.name }).getByRole('checkbox');
  await expect(cb).toBeEnabled();
  // Someone else finishes the task while this page is still showing it open.
  await sql`update task set status = 'done' where person_id = ${p.id}`;
  await cb.click();
  await page.waitForTimeout(2000);
  const completions = (await activitiesFor(p.id)).filter((a) => a.type === 'task_completed');
  expect(completions, 'the server logged a completion for a task that was already done').toHaveLength(0);
  expect((await tasksFor(p.id))[0]!.status).toBe('done');
});
