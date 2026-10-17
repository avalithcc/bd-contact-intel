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
  gated by `E2E_ALLOW_DESTRUCTIVE=1`) and the CSV import (`phase14.spec.ts`).
  Both skip on production. (The admin conversation spec, `phase11.spec.ts`, was
  deleted with the confirm flow it tested; the inline read and its "no audit
  row" rule are covered by `tests/db/adminInlineConversation.test.ts`.)
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

## Local-development guard (`next dev` refuses remote targets)

`next dev` refuses a non-loopback `DATABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
(`src/lib/dev/localDevGuard.ts`). Two paths here are affected:

- **Read-only mode on a hand-started `:3000` server** (the default): that server
  loads `.env.local` (production). Start it with the opt-out typed in the shell:
  `ALLOW_REMOTE_DB_IN_DEV=1 npx next dev -p 3000`. A value in a dotenv file is
  ignored on purpose. `npm run dev` now starts the local stack instead.
- **Scratch mode with a hosted Supabase project** (a throwaway project, or the
  `E2E_ALLOW_SHARED_SUPABASE=1` shared one), for `playwright.config.ts` (:3101)
  and `playwright.launch-readiness.config.ts` (:3100). `buildServerEnv` passes
  the opt-out in the server's process env, so nothing changes for you. The
  local Supabase stack never triggered the guard.

  Caveat, kept fail-closed on purpose: if any dev dotenv file sets
  `ALLOW_REMOTE_DB_IN_DEV=1`, these Playwright-started servers refuse to start
  too, even though `buildServerEnv` put the value in the child env, because
  `localDevCheck` re-reads the files and a dotenv value never counts. Remove it
  from the file.

## Writing mode (scratch database only)

The guard judges this process's `DATABASE_URL`, but writes land wherever the
app SERVER points. So when `DATABASE_URL` is a scratch database,
`playwright.config.ts` starts its own `next dev` on port 3101 with
`DATABASE_URL` passed explicitly and never reuses an existing server (a dev
server on `:3000` normally loads `.env.local`, i.e. production). Without a
scratch `DATABASE_URL` it keeps the old behaviour: it reuses a server on
`:3000`, which is safe because the request guard blocks writes.

To use it, build a scratch database from the migration chain (so row-level
security matches production; `db:push` leaves it off), seed it, bring up the
local Supabase stack ("Local Supabase" below) and run:

```bash
dropdb --if-exists bd_contact_intel_e2e && createdb bd_contact_intel_e2e
DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e npm run db:migrate
DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e \
  npx tsx scripts/seed-launch-readiness.ts --execute   # reads E2E_EMAIL from .env.e2e.local
DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e npm run test:e2e
```

No `E2E_ALLOW_SHARED_SUPABASE` is needed: with the local stack named in
`.env.e2e.local` the login never leaves your machine. Without it (and without a
throwaway project) the run refuses to start, see "Supabase isolation".

Always pass `DATABASE_URL` explicitly: `.env` and drizzle-kit load the
production URL. `.env.e2e.local` (gitignored) holds the scratch settings: the scratch
`DATABASE_URL` for the seed script and the `E2E_*` values of the local Supabase
stack. `playwright.config.ts` reads it FIRST, and only when the shell
`DATABASE_URL` is a scratch database, so a read-only run against `:3000` never
sees `E2E_SUPABASE_URL`. Only `E2E_*` keys are loaded from dotenv files, never
overriding variables already set (the shell wins, then `.env.e2e.local`, then
`.env.local`). Never put a production credential in it. The filter specs also pass on the tiny seed (the second BD
has one contact with a phone and one without, which the "responsable + Tiene
teléfono" spec needs to narrow); read-only mode against a dev server whose
database is the scratch one runs them too (start `ALLOW_REMOTE_DB_IN_DEV=1
DATABASE_URL=<scratch> npx next dev -p 3000`, then run Playwright with a
non-scratch `DATABASE_URL`).

Manual proof that the first-visit guard works end to end (2026-10-13, scratch
database): log in once so the e2e account has a `bd` row, rename that row's
email, then load a page with the marker header and without it. With the marker
the layout answers 500 ("No bd row for this session, and first-visit
provisioning is disabled for a read-only e2e request") and no row is inserted;
without it the page answers 200 and a row is inserted. The session cookie
reaches the server alongside the marker (`route.fallback({headers})` keeps it).

## Supabase isolation

The database and the login are both isolated when the local stack is used.
`auth.setup.ts` fills `#password` and logs in through whatever Supabase project
the app server is given. Left to `.env.local` that is production auth, so a
test run could lock out, rate-limit or otherwise touch real auth users; the
guard below refuses that unless you acknowledge it. The scratch database alone
does not change it.

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
- Two deliberate additions for Lusha (`lusha-per-bd.spec.ts`): the server gets
  `VERCEL_ENV=production` and `LUSHA_API_KEY=''`. Lusha is hidden entirely
  outside Vercel production (`src/lib/lusha/config.ts`), so without the first
  the per-BD gate would never render; with the key forced empty the config
  resolves to `missing_env`, the gate and its reasons render, and no request
  can reach Lusha. Specs never click a priced Lusha control.
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

### The launch-readiness config follows the same contract

`playwright.launch-readiness.config.ts` (manual QA pass, run by hand with
`npx playwright test -c playwright.launch-readiness.config.ts <file>`, no npm
script) writes data and logs in through the same Supabase Auth, so it had the
same silent inheritance and now uses the same rules through
`planIsolatedServer()` in `supabaseIsolation.ts`: a scratch `_e2e` database
(shell `DATABASE_URL` wins, `.env.e2e.local` may supply it), only `E2E_*` keys
loaded into the Playwright process, an explicit three-variable server env with
every other dotenv key blanked, and the same refusal and
`E2E_ALLOW_SHARED_SUPABASE=1` shell-only hatch (banner prefix
`[launch-readiness]`). Its pass never needs the shared project, so there is no
other opt-in. It always starts its own server on :3100 and never reuses one: a
server started by hand (`nohup next dev -p 3100`) would not carry this env.
Several spec files can run in one invocation (`... 05- 09- 10-`). The config
uses one worker, so every file shares the single `sql` pool in `helpers.ts`;
specs must not call `sql.end()` and must import `test` from `./helpers` (not
from `@playwright/test`): that `test` closes the pool once, when the worker
ends (`tests/unit/launchReadinessPool.test.ts` enforces both). What still
limits a multi-file run is shared data, not the pool: the files are not fully
independent (`06-` fails when run after `05-` because the shell builds the
day's follow-up queue once per server instance, so reseed and run `06-`
without `05-`), and `04-`, `03-` and `08-` have failures unrelated to the pool
(see the launch-readiness README).

### Pointing the suite at a throwaway hosted project (alternative)

Create the project, create the e2e user in it **with a password** (the same
email as `E2E_EMAIL` and a matching `bd` row in the scratch database), then add
to `.env.local`:

```
E2E_SUPABASE_URL=<throwaway project URL>
E2E_SUPABASE_ANON_KEY=<its anon key>
E2E_EMAIL=<that user's email>
E2E_PASSWORD=<its password>
```

Prefer the local stack below: it needs no hosted project at all.

## Local Supabase (auth for the scratch run)

Local Supabase provides AUTH only. The test database stays
`bd_contact_intel_e2e` in your system Postgres; Supabase's own Postgres
(`:54322`) holds nothing of ours.

### Why Colima and not Docker Desktop

`supabase start` needs a Docker-compatible runtime. We use **Colima**
(open source, free for any company size). Docker Desktop requires a paid
subscription for companies above 250 employees or $10M revenue. Do not
"simplify" this back to Docker Desktop.

### From nothing to a running suite

```bash
brew install colima docker supabase/tap/supabase
colima start                      # once per boot
supabase start                    # from the repo root; config is supabase/config.toml
cp tests/e2e/local-supabase.env.example .env.e2e.local   # or append it, see below
# add DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e to that file
npx tsx scripts/create-e2e-auth-user.ts --execute
```

If `.env.e2e.local` already exists (it holds the scratch `DATABASE_URL`), append
the `E2E_*` lines of `tests/e2e/local-supabase.env.example` instead of copying.
Services: Auth/API `http://127.0.0.1:54321`, Studio `:54323`, Mailpit (auth
mail) `:54324`. The anon key in the example is the public demo key every local
Supabase install ships with (issuer `supabase-demo`), so it is safe to track;
it is why the template is a tracked file. Never paste a production value there.

`scripts/create-e2e-auth-user.ts` creates the `E2E_EMAIL` user with
`E2E_PASSWORD`, email pre-confirmed (the app signs out unconfirmed accounts).
It is idempotent (an existing user gets its password reset), is a dry run
without `--execute`, prints no secret, and refuses any `E2E_SUPABASE_URL` that
is not loopback. Re-run it after every `supabase stop --no-backup`. The `bd`
row for the same email comes from `scripts/seed-launch-readiness.ts`
(`role = 'bd'`); the two must use the same `E2E_EMAIL`.

The same script also creates a second login, `admin-e2e@avalith.net` (override with `E2E_ADMIN_EMAIL`), with the
same password. It is only ever used by specs that need an admin next to the BD (`sequences-admin.spec.ts`): the spec
upserts that account's `bd` row as `role = 'admin'`, signs in through the real login form and saves its session to
`tests/.auth/admin-state.json` (gitignored). The shared session stays the BD (`role = 'bd'`).

Specs that must seed rows (a second BD's Sequences, scheduled emails, accented names) or read back what the app wrote
use `tests/e2e/scratchDb.ts`. It refuses anything but a local `*_e2e` database, the specs call
`skipUnlessWritesAllowed()` first (so read-only runs skip them with a reason), and each tags its rows with a random
per-run suffix and removes them in `afterAll`.

Prove a run used the local stack: `psql
postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select
payload->>'action', payload->>'actor_username', created_at from
auth.audit_log_entries order by created_at desc limit 3"` shows a `login` row
for the e2e user, and `docker logs supabase_auth_bd-contact-intel` shows
`POST /token` with `grant_type=password` and status 200.

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
