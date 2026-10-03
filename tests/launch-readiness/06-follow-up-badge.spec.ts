/**
 * First thing in the morning: the follow-up queue for today does not exist
 * until somebody opens /follow-ups, and the sidebar badge only counts rows
 * that already exist. Mariel opens the app, sees no number, and has no
 * reason to open Seguimientos.
 */
import { expect, test } from '@playwright/test';
import { sql } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

test('the sidebar badge shows today\'s follow-ups on the first page of the day, before she opens the queue', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-BADGE: the queue is built only by visiting /follow-ups; before that the badge is blank');
  await sql`delete from follow_up_queue_item`;
  await page.goto('/contacts');
  await page.waitForLoadState('networkidle');
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(text.replace(/\D+/g, ''), 'no number next to Seguimientos although follow-ups are due').not.toBe('');
});

test('the first visit to /follow-ups shows the same number in the sidebar as there are cards', async ({ page }) => {
  test.fail(!process.env.LR_SHOW_FINDINGS, 'F-BADGE: on the visit that builds the queue the badge is read before the rows exist');
  await sql`delete from follow_up_queue_item`;
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  const cards = await page.locator('main .card a.strong').count();
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(cards).toBeGreaterThan(0);
  expect(Number(text.replace(/\D+/g, '') || 0)).toBe(cards);
});
