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
  // The sidebar's locale and theme switchers are also submit buttons, so this
  // must be scoped to the login form itself.
  await page.locator('form:has(#email) button[type="submit"]').click();

  // Landing anywhere other than /login is the only proof the session took.
  // Surface whatever the form said, otherwise a bad credential looks like a
  // mysterious timeout.
  try {
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  } catch (err) {
    const shown = await page.locator('main, body').first().innerText();
    throw new Error(
      `Login did not complete for ${email}. Page text:\n${shown.slice(0, 600)}`,
    );
  }

  await page.context().storageState({ path: STORAGE_STATE });
});
