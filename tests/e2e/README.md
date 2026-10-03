# E2E (Playwright)

The browser suite logs in as a real BD user. Every page is auth-gated, so
without an account it would only test the login screen.

> It runs against whatever `DATABASE_URL` points at, which is usually
> **production**, so it is **read-only by construction**. The app has no delete
> path: anything written to production stays there forever.

## The read-only contract

Unless `DATABASE_URL` is a local database whose name ends in `_e2e` (the same
rule as `tests/launch-readiness/scratchDbGuard.ts`), the suite treats the
database as production. A missing or unparsable `DATABASE_URL` counts as
production too (fail closed). In that mode:

- **Every spec must import `test`/`expect` from `./fixtures`, not from
  `@playwright/test`.** The fixture aborts any request to the app that could
  write (any method other than GET/HEAD/OPTIONS, which is how a server action
  arrives, plus GETs to `/api/*` and `/auth/confirm`) and fails the test,
  listing the requests. Supabase and other origins are not inspected.
- **A test that writes must call `skipUnlessWritesAllowed()`** (`helpers.ts`).
  It skips outside a scratch database.
- Today those are: the duplicate-merge test (`phase7.spec.ts`, additionally
  gated by `E2E_ALLOW_DESTRUCTIVE=1`), the CSV import (`phase14.spec.ts`) and
  the admin conversation test (`phase11.spec.ts`, whose audit row is written by
  the `revealAdminConversationAction` server action). All skip on production.
  `phase11.spec.ts` is also stale: it targets a deleted route (see the comment
  at the top of that file) and needs rewriting or deleting.
- The setup project logs in through Supabase Auth (a session in Supabase's own
  `auth` schema, outside the app guard). It does not write app tables.
- **Known gap:** server-side writes during a plain GET render are invisible to
  the request guard. The one known case is `getCurrentBd`
  (`src/lib/queries.ts:80`, called from the app layout on every render), which
  inserts a `bd` row the first time a session email has none. A seeded e2e
  account already has its row, so this should not fire, but read-only is not
  strictly "by construction" until that write is gone or tested.

## Writing mode (scratch database only)

The guard judges this process's `DATABASE_URL`, but writes land wherever the
app SERVER points. So when `DATABASE_URL` is a scratch database,
`playwright.config.ts` starts its own `next dev` on port 3101 with
`DATABASE_URL` passed explicitly and never reuses an existing server (a dev
server on `:3000` normally loads `.env.local`, i.e. production). Without a
scratch `DATABASE_URL` it keeps the old behaviour: it reuses a server on
`:3000`, which is safe because the request guard blocks writes.

To use it, seed a scratch database (`scripts/seed-launch-readiness.ts`, see
`tests/launch-readiness`) and run
`DATABASE_URL=postgres://localhost/x_e2e npx playwright test`. The shell
variable wins over `.env.local`. The login still goes to the Supabase Auth
project configured in `.env.local`; whether that is acceptable for a scratch
run is unverified. The filter specs assert against production-scale data (real
BDs with phones, contact types), so the tiny seed does not satisfy them; run
them read-only against production.

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
