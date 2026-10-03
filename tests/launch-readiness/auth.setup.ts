import { test as setup, expect } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.join(__dirname, '../.auth/launch-readiness.json');

setup('authenticate against real Supabase Auth', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error('E2E_EMAIL / E2E_PASSWORD missing from .env.e2e.local');
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.locator('form:has(#email) button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
