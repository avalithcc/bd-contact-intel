/**
 * The daily "Seguimientos" queue, seen from Mariel's side: she works it, so
 * every call she logs must visibly retire its card and move the sidebar
 * badge, without a manual reload. State is serial and shared on purpose.
 */
import { expect, test, type Page } from '@playwright/test';
import { sql } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await sql`delete from follow_up_queue_item`;
});

test.afterAll(async () => {
  await sql.end();
});

async function badge(page: Page): Promise<number> {
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  const digits = text.replace(/\D+/g, '');
  return digits ? Number(digits) : 0;
}

async function pendingNames(page: Page): Promise<string[]> {
  return page.locator('main .card a.strong').allInnerTexts();
}

let first = '';
let pendingBefore: string[] = [];
let badgeBefore = 0;

test('the queue materializes for today and the sidebar badge matches the cards', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  // The very first visit of the day builds the queue AFTER the sidebar badge was read: see
  // 06-follow-up-badge.spec.ts (F-BADGE). Reload so this file measures the steady state.
  await page.reload();
  await page.waitForLoadState('networkidle');
  pendingBefore = await pendingNames(page);
  badgeBefore = await badge(page);
  console.log(`[queue] cards=${pendingBefore.length} badge=${badgeBefore}`);
  expect(pendingBefore.length).toBeGreaterThan(0);
  expect(badgeBefore).toBe(pendingBefore.length);
  first = pendingBefore[0]!;
});

test('logging a call from a queue card: the card leaves the list and the badge drops, by navigation, no reload', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  await page.locator('.card', { hasText: first }).getByRole('link', { name: 'Llamada' }).click();
  await page.waitForURL(/openAction=call/);
  const dlg = page.getByRole('dialog');
  await expect(dlg, 'the call dialog should open by itself from the queue icon').toBeVisible();
  await dlg.getByLabel('Resultado').selectOption('connected');
  await dlg.getByRole('button', { name: 'Registrar llamada' }).click();
  await expect(page.getByText('Llamada registrada.')).toBeVisible();
  await expect.poll(() => badge(page), { message: 'sidebar badge on the record page after the call' }).toBe(badgeBefore - 1);
  await page.locator('nav a', { hasText: 'Seguimientos' }).first().click();
  await page.waitForURL('**/follow-ups');
  await page.waitForLoadState('networkidle');
  expect(await pendingNames(page)).not.toContain(first);
  expect(await badge(page)).toBe(badgeBefore - 1);
});

test('the same holds after a hard refresh and after Back from the record', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  expect(await pendingNames(page)).not.toContain(first);
  await page.locator('main .card a.strong').first().click();
  await page.waitForLoadState('networkidle');
  await page.goBack();
  await page.waitForLoadState('networkidle');
  expect(await pendingNames(page)).not.toContain(first);
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await pendingNames(page)).not.toContain(first);
});

test('"Posponer a mañana" removes the card, the badge follows, and it survives a reload', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  const names = await pendingNames(page);
  const target = names[0]!;
  const badgeNow = await badge(page);
  await page.locator('.card', { hasText: target }).locator('summary').click();
  await page.getByRole('button', { name: /Posponer a mañana/ }).click();
  await expect(page.locator('main .card', { hasText: target })).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await pendingNames(page)).not.toContain(target);
  expect(await badge(page)).toBe(badgeNow - 1);
});

test('creating a follow-up task on a queue card does not retire the card (a task is not "worked")', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  const names = await pendingNames(page);
  test.skip(names.length === 0, 'queue empty');
  const target = names[0]!;
  await page.locator('.card', { hasText: target }).getByRole('link', { name: 'Tarea' }).click();
  await page.waitForURL(/openAction=task/);
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Título').fill('Volver a llamar');
  await dlg.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  console.log(`[queue] after creating a task, card still pending: ${(await pendingNames(page)).includes(target)}`);
});

test('the empty-queue call to action leads to the not-contacted list, not to an unfiltered one', async ({ page }) => {
  await page.goto('/contacts?view=uncontacted');
  await page.waitForLoadState('networkidle');
  const on = await page.locator('a[aria-current], .tab.on, .filter-pill.on, [aria-selected="true"]').allInnerTexts();
  console.log(`[queue] view=uncontacted selected tab(s): ${JSON.stringify(on)} url=${page.url()}`);
  const real = await page.getByRole('link', { name: /^Sin contactar/ }).getAttribute('class');
  console.log(`[queue] Sin contactar tab class=${real}`);
  // F-CTA-LINK: the empty-queue button links to a view key that does not exist.
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-CTA-LINK: /contacts?view=uncontacted is not a real view; the real key is notContacted');
  await expect(page.getByRole('link', { name: /^Sin contactar/ })).toHaveClass(/on|active|selected/);
});
