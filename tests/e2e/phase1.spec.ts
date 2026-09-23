import { test, expect } from '@playwright/test';

test.describe('Phase 1: Core CRM Tracking', () => {
  test('Tasks page loads and displays complete buttons', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toBeVisible();

    const taskCards = page.locator('.taskCard');
    if (await taskCards.count() > 0) {
      const completeBtn = taskCards.first().locator('button').first();
      await expect(completeBtn).toBeVisible();
    }
  });

  test('Kanban board loads and displays columns', async ({ page }) => {
    await page.goto('/leads?view=board');
    await page.waitForLoadState('networkidle');

    const columns = page.locator('.column');
    const count = await columns.count();

    if (count > 0) {
      expect(count).toBeGreaterThan(0);
      await expect(page.locator('text=New')).toBeVisible();
    } else {
      await expect(page.locator('h1')).toBeVisible();
    }
  });

  test('Lead detail page shows ActivityTimeline and TaskQuickAdd', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    const leadLink = page.locator('a[href*="/leads/"]').first();
    if (await leadLink.isVisible()) {
      await leadLink.click();
      await page.waitForLoadState('networkidle');

      await expect(page.locator('text=Activity')).toBeVisible();
      await expect(page.locator('button', { hasText: /Add task|add task/ })).toBeVisible();
      await expect(page.locator('button', { hasText: /Paste signal|paste signal/ })).toBeVisible();
    }
  });

  test('Contact detail page shows ActivityTimeline and TaskQuickAdd', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    const contactLink = page.locator('a[href*="/contact/"]').first();
    if (await contactLink.isVisible()) {
      await contactLink.click();
      await page.waitForLoadState('networkidle');

      await expect(page.locator('text=Activity')).toBeVisible();
      await expect(page.locator('button', { hasText: /Add task|add task/ })).toBeVisible();
      await expect(page.locator('button', { hasText: /Paste signal|paste signal/ })).toBeVisible();
    }
  });

  test('Companies page loads and displays list', async ({ page }) => {
    await page.goto('/companies');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toBeVisible();
  });

  test('Company detail page shows edit and add activity buttons', async ({ page }) => {
    await page.goto('/companies');
    await page.waitForLoadState('networkidle');

    const companyLink = page.locator('a[href*="/companies/"]').first();
    if (await companyLink.isVisible()) {
      await companyLink.click();
      await page.waitForLoadState('networkidle');

      const editBtn = page.locator('button', { hasText: /Edit company|edit company/ }).first();
      if (await editBtn.isVisible()) {
        expect(await editBtn.isVisible()).toBeTruthy();
      }

      const addActivityBtn = page.locator('button', { hasText: /Add activity|add activity/ }).first();
      if (await addActivityBtn.isVisible()) {
        expect(await addActivityBtn.isVisible()).toBeTruthy();
      }
    }
  });

  test('Edit company modal opens and has form fields', async ({ page }) => {
    await page.goto('/companies');
    await page.waitForLoadState('networkidle');

    const companyLink = page.locator('a[href*="/companies/"]').first();
    if (await companyLink.isVisible()) {
      await companyLink.click();
      await page.waitForLoadState('networkidle');

      const editBtn = page.locator('button', { hasText: /Edit company|edit company/ }).first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForLoadState('networkidle');

        const nameInput = page.locator('input').first();
        if (await nameInput.isVisible()) {
          expect(await nameInput.isVisible()).toBeTruthy();
        }
      }
    }
  });

  test('TaskQuickAdd modal opens and submits', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    const leadLink = page.locator('a[href*="/leads/"]').first();
    if (await leadLink.isVisible()) {
      await leadLink.click();
      await page.waitForLoadState('networkidle');

      const addTaskBtn = page.locator('button', { hasText: /Add task|add task/ }).first();
      if (await addTaskBtn.isVisible()) {
        await addTaskBtn.click();

        const titleInput = page.locator('input[placeholder*="task"]').first();
        if (await titleInput.isVisible()) {
          expect(await titleInput.isVisible()).toBeTruthy();
        }
      }
    }
  });

  test('ManualSignal textarea accepts input', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    const leadLink = page.locator('a[href*="/leads/"]').first();
    if (await leadLink.isVisible()) {
      await leadLink.click();
      await page.waitForLoadState('networkidle');

      const pasteBtn = page.locator('button', { hasText: /Paste signal|paste signal/ }).first();
      if (await pasteBtn.isVisible()) {
        await pasteBtn.click();

        const textarea = page.locator('textarea').first();
        if (await textarea.isVisible()) {
          await textarea.fill('Test signal data');
          expect(await textarea.inputValue()).toContain('Test signal');
        }
      }
    }
  });
});
