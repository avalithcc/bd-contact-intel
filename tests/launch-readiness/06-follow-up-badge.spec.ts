/**
 * F5 (fixed): first thing in the morning the follow-up queue for today does
 * not exist yet. The shell now builds it on the first page of the day
 * (src/lib/shell/readBadgeRowEnsuringQueue.ts), so the sidebar badge shows
 * the number without Mariel having to open Seguimientos first.
 */
import { expect, test } from '@playwright/test';
import { sql } from './helpers';

test.afterAll(async () => {
  await sql.end();
});

test('the sidebar badge shows today\'s follow-ups on the first page of the day, before she opens the queue', async ({ page }) => {
  await sql`delete from follow_up_queue_item`;
  await page.goto('/contacts');
  await page.waitForLoadState('networkidle');
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(text.replace(/\D+/g, ''), 'no number next to Seguimientos although follow-ups are due').not.toBe('');
});

test('the first visit to /follow-ups shows the same number in the sidebar as there are cards', async ({ page }) => {
  await sql`delete from follow_up_queue_item`;
  await page.goto('/follow-ups');
  await page.waitForLoadState('networkidle');
  const cards = await page.locator('main .card a.strong').count();
  const text = await page.locator('nav a', { hasText: 'Seguimientos' }).first().innerText();
  expect(cards).toBeGreaterThan(0);
  expect(Number(text.replace(/\D+/g, '') || 0)).toBe(cards);
});
