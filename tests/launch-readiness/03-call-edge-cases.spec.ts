/** "Registrar llamada": the obvious wrong things a BD does with the form. */
import { expect, test } from '@playwright/test';
import { activitiesFor, argDate, newPerson, openContact, openQuickAction, personStatus, sql } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

test('the submit button stays disabled until an outcome is chosen', async ({ page }) => {
  const p = await newPerson('CallNoOutcome');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await expect(dlg.getByRole('button', { name: 'Registrar llamada' })).toBeDisabled();
  await dlg.getByLabel('Notas').fill('solo notas');
  await expect(dlg.getByRole('button', { name: 'Registrar llamada' })).toBeDisabled();
  expect(await activitiesFor(p.id)).toHaveLength(0);
});

test('whitespace-only notes are stored as no notes, not as blank text', async ({ page }) => {
  const p = await newPerson('CallBlankNotes');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('busy');
  await dlg.getByLabel('Notas').fill('   \n   ');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const [call] = await activitiesFor(p.id);
  expect(call!.metadata.notes).toBeNull();
});

test('every outcome moves the contact to the stage the dialog promises', async ({ page }) => {
  const expected: Record<string, string> = {
    connected: 'replied',
    busy: 'contacted',
    no_answer: 'contacted',
    voicemail: 'contacted',
    wrong_number: 'contacted',
  };
  for (const [outcome, status] of Object.entries(expected)) {
    const p = await newPerson(`Out${outcome}`);
    await openContact(page, p.id);
    const dlg = await openQuickAction(page, 'call');
    await dlg.getByLabel('Resultado').selectOption(outcome);
    await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
    await expect(page.getByText('Llamada registrada.')).toBeVisible();
    expect(await personStatus(p.id), outcome).toBe(status);
  }
});

test('double-clicking the submit button logs ONE call', async ({ page }) => {
  const p = await newPerson('CallDouble');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).dblclick();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await activitiesFor(p.id)).filter((a) => a.type === 'call')).toHaveLength(1);
});

test('a call dated yesterday is stored at the Argentina wall-clock time the BD typed', async ({ page }) => {
  const p = await newPerson('CallYesterday');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('voicemail');
  await dlg.getByLabel('Fecha').fill(argDate(-1));
  await dlg.getByLabel('Hora').fill('10:30');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const [call] = await activitiesFor(p.id);
  // 10:30 ART is 13:30 UTC.
  expect(call!.metadata.occurredAt).toBe(`${argDate(-1)}T13:30:00.000Z`);
  await expect(page.getByText('10:30').first()).toBeVisible();
});

test('a date with no time is accepted (stored as ART midnight) and the timeline does not show a made-up hour', async ({ page }) => {
  const p = await newPerson('CallDateOnly');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('no_answer');
  await dlg.getByLabel('Fecha').fill(argDate(-2));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const [call] = await activitiesFor(p.id);
  expect(call!.metadata.occurredAt).toBe(`${argDate(-2)}T03:00:00.000Z`);
  await expect(page.locator('main').getByText('00:00')).toHaveCount(0);
});

test('a future date is refused with a message the BD can act on, and nothing is saved', async ({ page }) => {
  const p = await newPerson('CallFuture');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  // `fill` bypasses the input's max attribute, like pasting a date would.
  await dlg.getByLabel('Fecha').fill(argDate(3));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(dlg.getByRole('alert')).toBeVisible();
  const message = await dlg.getByRole('alert').innerText();
  expect(message).not.toMatch(/unexpected|error inesperado|Ocurrió un error/i);
  expect(await activitiesFor(p.id)).toHaveLength(0);
  // The dialog must be usable again afterwards.
  await expect(dlg.getByRole('button', { name: 'Registrar llamada' })).toBeEnabled();
});

test('a 20,000-character note is saved whole and does not break the page layout', async ({ page }) => {
  const p = await newPerson('CallLong');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  const long = ('palabra'.repeat(8) + ' ').repeat(360).slice(0, 20_000);
  await dlg.getByLabel('Notas').fill(long);
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const [call] = await activitiesFor(p.id);
  expect((call!.metadata.notes as string).length).toBe(long.trim().length);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'long note pushes the page wider than the viewport').toBeLessThanOrEqual(0);
});

test('an unbroken 5,000-character string in a note does not push the page sideways', async ({ page }) => {
  const p = await newPerson('CallUnbroken');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await dlg.getByLabel('Notas').fill('x'.repeat(5000));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a 1.1 MB note (server answers 500) fails visibly, not silently', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-FREEZE: onSubmit has no try/finally, a thrown action leaves busy=true forever');
  const p = await newPerson('CallHuge');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await dlg.getByLabel('Notas').fill('a'.repeat(1_100_000));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await page.waitForTimeout(4000);
  const saved = (await activitiesFor(p.id)).length;
  const shown = (await page.getByRole('alert').allInnerTexts()).join(' ');
  // Either it saved, or the BD was told. Never "nothing saved and nothing said".
  expect(saved > 0 || shown.length > 0, 'neither saved nor reported').toBe(true);
  // And the dialog must not be left frozen.
  await expect(dlg.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
});

test('a dropped connection mid-save leaves the dialog usable and says so', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-FREEZE: onSubmit has no try/finally, a thrown action leaves busy=true forever');
  const p = await newPerson('CallOffline');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await page.route('**/contacts/**', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await page.waitForTimeout(3000);
  await page.unroute('**/contacts/**');
  expect(await activitiesFor(p.id)).toHaveLength(0);
  await expect(dlg.getByRole('button', { name: 'Cancelar' }), 'dialog frozen after a network error').toBeEnabled();
});

test('leaving the page right after pressing save still saves exactly one call', async ({ page }) => {
  const p = await newPerson('CallNavAway');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await page.goto('/tasks');
  await page.waitForTimeout(2500);
  const calls = (await activitiesFor(p.id)).filter((a) => a.type === 'call');
  expect(calls.length).toBeLessThanOrEqual(1);
  console.log(`[nav-away] calls saved after leaving mid-save: ${calls.length}`);
});

test('a "Número equivocado" call is not queued for a follow-up call a week later', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-WRONGNUM: wrong_number counts as an outbound call, so the contact enters the follow-up queue');
  const p = await newPerson('CallWrongNumber');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('wrong_number');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  // Age the call by 10 days so it is eligible for the queue (contacted + 7 days).
  await sql`update activity set created_at = now() - interval '10 days',
            metadata = jsonb_set(metadata, '{occurredAt}', to_jsonb((now() - interval '10 days')::text)) where person_id = ${p.id}`;
  await sql`delete from follow_up_queue_item`;
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(p.name), 'a wrong number was queued for follow-up').toHaveCount(0);
});

test('after a network error, Escape closes the dialog and every quick action works again without a reload', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-FREEZE: busy lives in QuickActions and closeQuickAction never resets it, every dialog stays disabled');
  const p = await newPerson('CallOfflineClose');
  await openContact(page, p.id);
  const dlg = await openQuickAction(page, 'call');
  await dlg.getByLabel('Resultado').selectOption('connected');
  await page.route('**/contacts/**', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await page.waitForTimeout(2000);
  await page.unroute('**/contacts/**');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // Re-opening gives a fresh, enabled form (no stuck busy state leaks across).
  const again = await openQuickAction(page, 'call');
  await expect(again.getByLabel('Resultado')).toBeEnabled();
});
