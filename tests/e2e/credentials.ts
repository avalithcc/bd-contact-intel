/**
 * Pure helpers deciding what the e2e suite does when no test account is
 * configured. Kept free of Playwright imports so they are unit-testable
 * (tests/unit/e2eCredentials.test.ts).
 *
 * Local vs CI: the suite SKIPS (with a reason) when credentials are absent and
 * `CI` is not set, and FAILS LOUDLY when `CI` is set. `CI` is the variable
 * GitHub Actions, Vercel and most runners set, and playwright.config.ts
 * already keys `forbidOnly`/`retries` off it.
 */

type Env = Record<string, string | undefined>;

export function isCi(env: Env = process.env): boolean {
  const v = (env.CI ?? '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

export function readE2eCredentials(
  env: Env = process.env,
): { email: string; password: string } | null {
  const email = env.E2E_EMAIL?.trim();
  const password = env.E2E_PASSWORD;
  if (!email || !password || !password.trim()) return null;
  return { email, password };
}

/** A skip reason when the suite cannot authenticate and we are NOT in CI. */
export function skipReason(env: Env = process.env): string | null {
  if (readE2eCredentials(env) || isCi(env)) return null;
  return (
    'skipped: no E2E credentials (set E2E_EMAIL and E2E_PASSWORD in .env.local — ' +
    'see tests/e2e/README.md)'
  );
}

export function missingCredentialsMessage(): string {
  return [
    'E2E credentials are missing: the browser suite cannot log in.',
    '',
    '  1. Use a real BD user: a row in the `bd` table whose email also has a',
    '     Supabase Auth login (the same account you sign in with at /login).',
    '     Prefer a dedicated test account.',
    '  2. Put its credentials in .env.local (gitignored):',
    '       E2E_EMAIL=<that email>',
    '       E2E_PASSWORD=<its password>',
    '  3. Run:  npx playwright test --project=setup',
    '',
    'The saved session (tests/.auth/state.json) expires when its Supabase',
    'refresh token dies. If pages redirect to /login, re-run the setup project.',
    'Details: tests/e2e/README.md. Without these variables the suite would test',
    'the login page and report false passes, so CI must fail here.',
  ].join('\n');
}
