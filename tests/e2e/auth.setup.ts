// The guarded `test`, not Playwright's: the post-login landing renders the app
// layout, which is where getCurrentBd would insert a missing `bd` row.
import { test as setup, expect } from './fixtures';
import path from 'path';
import { DEV_SERVER_PROBE_PATH, devServerRefusal, writesAllowed } from './readOnlyGuard';
import { missingCredentialsMessage, readE2eCredentials, skipReason } from './credentials';

export const STORAGE_STATE = path.join(__dirname, '../.auth/state.json');

// Every page in this app is auth-gated and redirects to /login. Without a real
// session the whole suite silently exercises the login screen instead of the
// feature under test. So: locally (no CI) a missing account SKIPS with a clear
// reason; in CI it hard-fails. See credentials.ts and tests/e2e/README.md.
setup('authenticate', async ({ page }) => {
  const reason = skipReason();
  setup.skip(reason !== null, reason ?? '');

  const creds = readE2eCredentials();
  if (!creds) throw new Error(missingCredentialsMessage());
  const { email, password } = creds;

  // Before the login: the post-login landing is the first render that could
  // provision a bd row, and only a dev server honors the read-only marker.
  if (!writesAllowed(process.env.DATABASE_URL)) {
    const probe = await page.request.get(DEV_SERVER_PROBE_PATH).catch(() => undefined);
    const refusal = devServerRefusal(probe?.status());
    if (refusal) throw new Error(refusal);
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
