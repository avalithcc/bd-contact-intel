# E2E (Playwright)

The browser suite logs in as a real BD user. Every page is auth-gated, so
without an account it would only test the login screen.

> It runs against whatever `DATABASE_URL` points at, which is **production**.
> The specs are read-only; keep new ones read-only too.

## One-time setup

1. Create a **dedicated test BD user**: a row in the `bd` table whose email also
   has a Supabase Auth login (the same kind of account you use at `/login`).
2. Add to `.env.local` (gitignored; `playwright.config.ts` loads it):
   ```
   E2E_EMAIL=<test account email>
   E2E_PASSWORD=<its password>
   ```
3. Log in and save the session:
   ```bash
   npx playwright test --project=setup
   ```
4. Run everything: `npm run test:e2e` (the setup project runs first and
   refreshes the session on every full run).

## When it stops working

- The saved session (`tests/.auth/state.json`) lasts as long as the Supabase
  refresh token. When it dies, pages redirect to `/login` and the tests fail
  with "session is missing or STALE". Fix: re-run step 3.
- No credentials set: locally every test is **skipped** with
  "skipped: no E2E credentials"; with `CI` set it **fails**.
