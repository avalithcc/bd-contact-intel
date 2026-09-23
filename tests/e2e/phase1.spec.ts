import { test, expect } from '@playwright/test';
import { gotoAuthed, openFirstOrSkip } from './helpers';

test.describe('Phase 1: Core CRM Tracking', () => {
  test('Tasks page lists tasks with a complete control', async ({ page }) => {
    await gotoAuthed(page, '/tasks');
    await expect(page.locator('h1')).toContainText(/Tasks/i);

    const cards = page.locator('[class*="taskCard"]');
    if ((await cards.count()) === 0) {
      // An empty list must say so, not quietly pass as if it had rendered tasks.
      await expect(page.locator('text=/No open tasks/i')).toBeVisible();
      return;
    }
    await expect(cards.first().locator('button')).toBeVisible();
  });

  test('Kanban board renders every pipeline column', async ({ page }) => {
    await gotoAuthed(page, '/leads?view=board');

    for (const status of ['New', 'Contacted', 'Replied', 'Meeting', 'Discarded']) {
      await expect(
        page.locator(`[class*="columnTitle"]`, { hasText: new RegExp(`^${status}$`, 'i') }),
      ).toBeVisible();
    }
  });

  test('Lead detail shows activity timeline, task quick-add and signal paste', async ({ page }) => {
    await gotoAuthed(page, '/leads');
    const result = await openFirstOrSkip(page, '/leads/', 'leads');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await expect(page.locator('h2', { hasText: /Activity/ })).toBeVisible();
    await expect(page.locator('button', { hasText: /Add task/i })).toBeVisible();
    await expect(page.locator('button', { hasText: /Paste signal/i })).toBeVisible();
  });

  test('Task quick-add opens a titled form', async ({ page }) => {
    await gotoAuthed(page, '/leads');
    const result = await openFirstOrSkip(page, '/leads/', 'leads');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.locator('button', { hasText: /Add task/i }).click();
    const title = page.locator('input[placeholder*="Task title" i]');
    await expect(title).toBeVisible();
    await title.fill('Follow up next week');
    await expect(title).toHaveValue('Follow up next week');
  });

  test('Signal paste accepts and retains input', async ({ page }) => {
    await gotoAuthed(page, '/leads');
    const result = await openFirstOrSkip(page, '/leads/', 'leads');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.locator('button', { hasText: /Paste signal/i }).click();
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill('Saw they opened a Buenos Aires engineering hub.');
    await expect(textarea).toHaveValue(/Buenos Aires/);
  });

  test('Companies page lists companies', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('Company detail exposes edit and add-activity controls', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await expect(page.locator('button', { hasText: /Edit company/i })).toBeVisible();
    await expect(page.locator('button', { hasText: /Add activity/i })).toBeVisible();
  });

  test('Edit company modal opens prefilled with the current name', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    const heading = await page.locator('h1').first().innerText();
    await page.locator('button', { hasText: /Edit company/i }).click();

    await expect(page.locator('text=Edit Company')).toBeVisible();
    // Prefill is the point of the modal — an empty field would silently wipe data on save.
    await expect(page.locator('input[type="text"]').first()).toHaveValue(heading.trim());
  });

  test('Add activity modal opens with a note field', async ({ page }) => {
    await gotoAuthed(page, '/companies');
    const result = await openFirstOrSkip(page, '/companies/', 'companies');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.locator('button', { hasText: /Add activity/i }).click();
    await expect(page.locator('textarea[placeholder*="What happened" i]')).toBeVisible();
  });
});
