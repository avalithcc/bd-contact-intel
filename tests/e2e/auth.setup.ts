import { test as setup, expect } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE = path.join(__dirname, '../.auth/state.json');

// Every page in this app is auth-gated and redirects to /login. Without a real
// session the whole suite silently exercises the login screen instead of the
// feature under test, so this must hard-fail rather than skip.
setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_EMAIL and E2E_PASSWORD must be set. Without them the suite would ' +
        'test the login page and report false passes.',
    );
  }

  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');

  // Landing anywhere other than /login is the only proof the session took.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
