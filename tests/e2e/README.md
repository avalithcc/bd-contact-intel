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
  the admin conversation tests (`phase11.spec.ts`, whose audit row is written
  by the `revealAdminConversationAction` server action; they flip the e2e
  account's role to admin and restore it to the hard-coded `bd` baseline, and
  the seed resets it on conflict, so a hard kill is repaired by a rebuild; they also read
  `audit_log` directly, which is safe because they only run on a scratch
  database). All skip on production.
- The setup project logs in through Supabase Auth (a session in Supabase's own
  `auth` schema, outside the app guard). It does not write app tables.
- **Server-side writes during a plain GET render** are invisible to a request
  guard. The one known case, `getCurrentBd` (`src/lib/queries.ts`, called from
  the app layout on every render) inserting a `bd` row on a session's first
  visit, is closed another way: the guard adds an `x-e2e-read-only: 1` header
  to every request it lets through to the app, and `getCurrentBd` throws
  instead of inserting when it sees it (`src/lib/auth/bdProvisioning.ts`). The
  marker is ignored when `NODE_ENV` is `production`, so a real BD's first visit
  always provisions their row. `auth.setup.ts` uses the guarded `test` for the
  same reason (the post-login landing renders the layout).
  **So read-only mode assumes a `next dev` server.** In read-only mode
  `playwright.config.ts` reuses whatever is listening on :3000; if that is
  `next start`, `NODE_ENV` is `production`, the marker is ignored, and a first
  visit by an account with no `bd` row inserts one. The suite therefore
  refuses: `auth.setup.ts` probes `/_next/static/development/_buildManifest.js`
  (only `next dev` serves it) before logging in and throws on anything but 200
  (`devServerRefusal` in `readOnlyGuard.ts`). Scratch mode starts its own dev
  server, so it is not affected. Vercel is not affected either: the project
  defines no `NODE_ENV`, so Next's default applies (`development` for `next
  dev`, `production` for every other command, `node_modules/next/dist/bin/next`);
  previews run `next build` and serve the build, so they are `production` and
  ignore the marker.

## Writing mode (scratch database only)

The guard judges this process's `DATABASE_URL`, but writes land wherever the
app SERVER points. So when `DATABASE_URL` is a scratch database,
`playwright.config.ts` starts its own `next dev` on port 3101 with
`DATABASE_URL` passed explicitly and never reuses an existing server (a dev
server on `:3000` normally loads `.env.local`, i.e. production). Without a
scratch `DATABASE_URL` it keeps the old behaviour: it reuses a server on
`:3000`, which is safe because the request guard blocks writes.

To use it, build a scratch database from the migration chain (so row-level
security matches production; `db:push` leaves it off), seed it, and run:

```bash
dropdb --if-exists bd_contact_intel_e2e && createdb bd_contact_intel_e2e
DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e npm run db:migrate
DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e \
  E2E_EMAIL=<test account email> npx tsx scripts/seed-launch-readiness.ts --execute
E2E_ALLOW_SHARED_SUPABASE=1 DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e npx playwright test
```

`E2E_ALLOW_SHARED_SUPABASE=1` is explained in "Supabase isolation" below; without
it (and without a throwaway project) the run refuses to start.

Always pass `DATABASE_URL` explicitly: `.env` and drizzle-kit load the
production URL. `.env.e2e.local` (gitignored) may hold the scratch
`DATABASE_URL` and `E2E_EMAIL` for the seed script; never put a production
credential in it. `E2E_PASSWORD` stays in `.env.local`, which
`playwright.config.ts` loads without overriding variables already set (only
`E2E_*` keys are loaded from dotenv files, see below). The shell variable wins
over `.env.local`. The filter specs also pass on the tiny seed (the second BD
has one contact with a phone and one without, which the "responsable + Tiene
teléfono" spec needs to narrow); read-only mode against a dev server whose
database is the scratch one runs them too (start `DATABASE_URL=<scratch>
npx next dev -p 3000`, then run Playwright with a non-scratch `DATABASE_URL`).

Manual proof that the first-visit guard works end to end (2026-10-13, scratch
database): log in once so the e2e account has a `bd` row, rename that row's
email, then load a page with the marker header and without it. With the marker
the layout answers 500 ("No bd row for this session, and first-visit
provisioning is disabled for a read-only e2e request") and no row is inserted;
without it the page answers 200 and a row is inserted. The session cookie
reaches the server alongside the marker (`route.fallback({headers})` keeps it).

## Supabase isolation

Only the database is isolated today. **The Supabase project is still shared**:
`auth.setup.ts` fills `#password` and logs in through the real Supabase Auth
project that `.env.local` points at. That is production auth, so a test run can
lock out, rate-limit or otherwise touch real auth users. The scratch database
does not change that.

### Env contract

`playwright.config.ts` (rules in `supabaseIsolation.ts`, tests in
`tests/unit/e2eSupabaseIsolation.test.ts`):

- **The Playwright process** loads only `E2E_*` keys from the dotenv files
  (`.env.development.local`, `.env.local`, `.env.development`, `.env`; the shell
  wins). A production `DATABASE_URL` or an OAuth secret in `.env.local` never
  enters it.
- **The app server it starts** (scratch mode, port 3101) is given exactly three
  values: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Every other key defined in a dotenv file is
  set to an empty string in the server's environment. `next dev` never
  overrides a variable that is already defined, even empty, so a secret added
  to `.env.local` tomorrow (Gmail key, OAuth secret, SMTP) cannot reach the test
  server and nothing here needs editing. If a spec ever needs another variable,
  add it to `buildServerEnv` on purpose.
- Not covered: a secret exported in your shell (not in a dotenv file) is still
  inherited by the server. Do not export production secrets before a run.
- Read-only mode reuses a server the suite did not start, so none of this can
  be enforced there; that server keeps its own `.env.local`.

### The guard and its escape hatch

The repository cannot know which Supabase project is production without
committing a project ref, so it fails closed the other way round: a project is
used silently only if you NAME it for e2e. Otherwise the run refuses to start
(at config load, in under a second) with a message saying what to do.

- `E2E_SUPABASE_URL` + `E2E_SUPABASE_ANON_KEY` (both, different from
  `NEXT_PUBLIC_SUPABASE_URL`): a dedicated project, no warning. The same value
  as the app's own project still counts as shared.
- `E2E_ALLOW_SHARED_SUPABASE=1`: deliberate acknowledgement that this run uses
  the shared project. It is honoured only when typed in the shell for that run,
  never from a dotenv file, and every such run prints a `[e2e] WARNING` banner.
  Any value other than `1` is ignored.
- No credentials means every test is skipped and nothing logs in, so the guard
  does not run.

### Pointing the suite at a throwaway Supabase project (one step)

Create the project, create the e2e user in it **with a password** (the same
email as `E2E_EMAIL` and a matching `bd` row in the scratch database), then add
to `.env.local`:

```
E2E_SUPABASE_URL=<throwaway project URL>
E2E_SUPABASE_ANON_KEY=<its anon key>
E2E_EMAIL=<that user's email>
E2E_PASSWORD=<its password>
```

Drop `E2E_ALLOW_SHARED_SUPABASE=1` from the command. Nothing else changes.

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

> Stop any `npm run dev` before a scratch run. The scratch server starts on its
> own port, but Next 15.5 has no dev lock, so a second `next dev` in this
> directory shares `.next` with the first and can corrupt the dev cache. That is
> a nuisance, not data loss.
