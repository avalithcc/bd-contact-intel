# BD Contact Intelligence — v1

Internal tool for Avalith's sales area. Each Business Developer keeps a private
contact base loaded from their LinkedIn `Connections.csv`, with filtering and a
team-overlap signal that names which teammate also holds a given contact.

See `../concepto.md` and `../diseno-tecnico.md` for product and architecture.

## Stack
Next.js (App Router) + TypeScript · Postgres (Supabase) · Drizzle ORM.

## Setup
```bash
npm install
cp .env.example .env      # set DATABASE_URL (Supabase → Database → Connection string)
npm run db:migrate        # replay the migration chain onto an empty database
npm run dev               # http://localhost:3000
```

### Standing up a new environment

Use `npm run db:migrate`, not `db:push`. Replaying the chain is the only path
that reproduces what production actually has (constraint names included) and it
leaves `drizzle.__drizzle_migrations` correctly populated, so the next migration
applies instead of being silently skipped. Verified 2026-10-13 from an empty
local database: 41 ledger rows, 37 tables, 133 indexes, row-level security on
for 37 of 37 tables.

**`db:push` is for inspecting drift, not for building anything anyone will use.**
`src/db/schema.ts` declares no RLS; `drizzle/0019_enable_rls.sql` is what turns it
on. Measured 2026-10-13: a `db:push`-built database has RLS **off on all 37
tables**, a chain-built one has it on for 37/37. A database built with `db:push`
silently reopens the exposure `0019` closed.

**This only works on an empty database.** `npm run db:migrate` against an
already-populated database that was built with `db:push` fails hard, e.g.
`PostgresError: column "is_startup" of relation "target_company" already exists`
(`42701`, from `drizzle/0010_flowery_sunset_bain.sql:1`). The whole run is one
transaction, so it rolls back and the ledger stays at 0 rows; nothing is half
applied, but nothing moves forward either. Such a database cannot be migrated
forward: rebuild it from empty (drop, create, `db:migrate`). The case is
documented at `tests/db/aliasEquivalence.test.ts:48-50`, and the e2e database's
rebuild recipe is in `tests/e2e/README.md`.

**Always pass `DATABASE_URL` explicitly.** drizzle-kit auto-loads `.env`, where
the production URL lives, so a bare `npm run db:migrate` or `db:push` points at
production:

```bash
createdb my_scratch_db
DATABASE_URL='postgres://localhost:5432/my_scratch_db' npm run db:migrate
```

Two harmless things to expect: a `42622` NOTICE about a constraint identifier
truncated to Postgres's 63-character limit, and — off Supabase — the
`anon`/`authenticated` privilege revoke in `0019_enable_rls.sql` skipping itself
because those roles only exist on Supabase.

`npm run db:push` still runs and syncs `src/db/schema.ts` directly, but it
writes no ledger rows and names five foreign keys differently from production
(on top of leaving RLS off, above). Point it at a scratch database to inspect
drift against `src/db/schema.ts`, never at one anybody will use. Details in
`openspec/BACKLOG.md`.

Also set `CRON_SECRET` (a random string) as an env var in the deployment
environment (e.g. Vercel project settings) — it authenticates the
`/api/hiring/sync` cron endpoint. That route fails closed if it's unset.

Browser tests (Playwright) need a test BD account: see `tests/e2e/README.md`.

### One-time Supabase Storage setup (messages.csv import)

LinkedIn's `messages.csv` export runs ~6.5MB, too big for a server action's
request body on Vercel (capped around 4.5MB regardless of Next.js's own
`serverActions.bodySizeLimit`). Instead, the browser uploads the file
directly to a private Supabase Storage bucket with the user's own session,
namespaced under their auth user id, and the server action only receives
the resulting storage path (see `src/lib/storage.ts` and
`src/app/actions.ts#uploadMessagesCsv`).

This requires a one-time manual setup in the Supabase dashboard — it is
**not** run automatically by this app:

1. **Create the bucket.** Dashboard → Storage → New bucket:
   - Name: `linkedin-imports` (must match `MESSAGES_IMPORT_BUCKET` in
     `src/lib/storage.ts` exactly)
   - Public: **off** (private bucket)

2. **Add RLS policies** so an authenticated user can only insert, read, and
   delete objects inside their own `<auth.uid()>/` folder. Paste this into
   the Supabase SQL editor (Dashboard → SQL Editor):

   ```sql
   create policy "linkedin-imports: own folder insert"
   on storage.objects for insert
   to authenticated
   with check (
     bucket_id = 'linkedin-imports'
     and (storage.foldername(name))[1] = auth.uid()::text
   );

   create policy "linkedin-imports: own folder select"
   on storage.objects for select
   to authenticated
   using (
     bucket_id = 'linkedin-imports'
     and (storage.foldername(name))[1] = auth.uid()::text
   );

   create policy "linkedin-imports: own folder delete"
   on storage.objects for delete
   to authenticated
   using (
     bucket_id = 'linkedin-imports'
     and (storage.foldername(name))[1] = auth.uid()::text
   );
   ```

   No service-role key is used anywhere in this flow — both the browser
   upload and the server-side download/delete run as the signed-in user,
   scoped by these policies. The server action additionally re-checks that
   the submitted path is prefixed with the caller's own auth user id before
   touching Storage, as defense in depth against a tampered path.

3. After a successful import, the app deletes the staged object itself so
   message content doesn't sit in Storage longer than needed. If deletion
   fails, the import still succeeds and the app reports the cleanup failure
   so it can be removed manually.

## Getting the input file
LinkedIn → Settings & Privacy → Data Privacy → Get a copy of your data →
select **Connections** only → Request archive. Import the resulting
`Connections.csv` from the app.

## Hiring signals: markets (LATAM / US / other)

`job_posting.market` classifies each synced posting's `location` into a
coarse geography bucket (`latam` | `us` | `other`) via
`src/lib/hiring/markets.ts#classifyMarket`, and drives the market filter on
`/hiring`, `/outreach` and `/whats-new`. `target_company.country_filter` is
**deprecated**: `syncCompany` (`src/lib/hiring/sync.ts`) used to silently
DROP every posting whose location didn't match that per-company filter — a
US opening at an Argentina-flagged company was lost at import and
unrecoverable. It no longer does; every posting the ATS returns is now
stored and tagged with its `market` instead. The `country_filter` column is
left in place (not dropped) but ignored by sync.

After pulling this change, run in order:
1. Apply `drizzle/0006_job_posting_market.sql` through the migration chain
   (`npm run db:migrate`, see "Migrations" below) — adds `job_posting.market` +
   its index. Do not use `db:push` for this; see "Standing up a new
   environment" for why.
2. `npx tsx scripts/backfill-posting-markets.ts` — classifies `market` for
   every existing row.
3. Trigger a sync (`/api/hiring/sync` or `syncAllCompanies()`) — re-fetches
   from each ATS so postings previously dropped by the old country filter
   (e.g. US openings at LATAM-flagged companies) are picked up.

## Migrations

`drizzle-kit migrate` decides what to run from `drizzle/meta/_journal.json`,
comparing each entry's `when` timestamp against the latest `created_at` in
`drizzle.__drizzle_migrations`. It does NOT compare hashes, so a new entry
whose `when` is earlier than the last applied one is silently skipped while
`migrate` still prints "migrations applied successfully".

`drizzle/meta/` (journal and snapshots) is committed so every checkout shares
the same journal. Rules:

- Generate migrations with `npm run db:generate` and commit the SQL file
  together with the updated `drizzle/meta/` files.
- **Hand-set the new entry's `when`.** The journal chain is future-dated
  (ends ~2026-10-19) and production's latest `created_at` equals its last
  `when`, so `npm run db:generate` (real clock, lower) produces an entry that
  `migrate` silently skips. Set it to the previous entry's `when` + 86,400,000.
  `tests/unit/drizzleJournal.test.ts` prints the exact value. Never rewrite
  older entries: the ledger rows keep their old `created_at`, so lowering them
  would make every new real-clock migration skip. Once the clock passes the
  chain (after 2026-10-19), `db:generate` works unaided again.
- Vercel does not run migrations. Apply them by hand with
  `node --env-file=.env.local node_modules/.bin/drizzle-kit migrate`.
- Never trust the success message: verify the objects exist afterwards, e.g.
  `select to_regclass('public.<table>')`.
- Don't use `drizzle-kit push` against production: it changes the schema
  without recording anything in the ledger. Don't use it to build any other
  environment either: it leaves RLS off (see "Standing up a new environment").

## Leads ingest API (external push from lead_gen)

`POST /api/leads/ingest` lets the sibling `lead_gen` repo push leads
directly, without going through the `/leads` upload UI. Set
`LEADS_INGEST_TOKEN` (a random string) as an env var in the deployment
environment (e.g. Vercel project settings) — this route fails closed if
it's unset, same as `CRON_SECRET` above.

Auth: `Authorization: Bearer <LEADS_INGEST_TOKEN>` header. Missing or
invalid → `401 { "error": "Unauthorized" }`.

Request body:
```json
{
  "source": { "key": "fi-arg-2026", "displayName": "FI ARG 2026" },
  "leads": [
    {
      "attendeeId": "12345",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "jobTitle": "CTO",
      "seniority": "C-level",
      "companyRaw": "Acme Inc",
      "companyDisplay": "Acme",
      "companyGroup": "Acme Group",
      "companyKey": null,
      "industryRaw": "Fintech",
      "industryGroup": "Financial Services",
      "city": "Buenos Aires",
      "region": "CABA",
      "country": "Argentina",
      "attendeeType": "Attendee",
      "email": "ada@acme.com",
      "emailStatus": "probable",
      "emailConfidence": 87,
      "emailSource": "hunter",
      "owner": "Macarena"
    }
  ]
}
```
Field names mirror `LeadDraft` (`src/lib/leads/csv.ts`) and the `lead`
table (`src/db/schema.ts`) — there's no `phone` field, `firstName`/`lastName`
instead of a single `name`, `jobTitle` instead of `title`, etc. A `status`
field is accepted and validated but never written: `importLeads` deliberately
excludes `status` from its upsert so a BD's status edits in the app survive
a re-import untouched (see the comment on `importLeads` in
`src/lib/leads/queries.ts`), and this endpoint honors the same rule.

- `source.key` is required, non-empty.
- `leads` must be a non-empty array, capped at 2000 items; the request body
  is capped at 4MB, checked before any parsing/validation work.
- Each lead needs a stable `attendeeId`. If omitted, it's derived as
  `sha256(\`${sourceKey}:${normalizedEmail}\`)` (hex) — so the derivation
  requires an email; a lead with neither `attendeeId` nor `email` is skipped
  and reported back rather than failing the whole batch.
- `emailStatus` must be one of `verified` | `probable` | `none` if provided
  (defaults to `probable` if an `email` is given without an explicit status,
  `none` otherwise). An invalid value skips just that lead.
- Upsert is idempotent, keyed on `(source_key, attendee_id)`, via the same
  `importLeads` path the CSV importer uses — owner strings resolve through
  `matchOwnersToBd` and a previously-assigned owner is never overwritten by
  a re-import that doesn't resolve one.

Response (`200`):
```json
{
  "ok": true,
  "upserted": 812,
  "matchedOwners": 3,
  "unmatchedOwners": 1,
  "skipped": [{ "index": 42, "reason": "invalid emailStatus \"maybe\" (expected one of verified, probable, none)" }]
}
```
`400` on a malformed request (bad JSON, missing `source.key`, empty/oversized
`leads`, or a batch where every lead was skipped), with an `error` message
and, where applicable, the same `skipped` array.

## Lusha reveal

A BD can reveal a Contact's email or phone through Lusha from the Contact record. Every reveal spends real
credits from one shared pool, so the feature is gated and capped server-side.

| Variable | Where | Meaning |
| --- | --- | --- |
| `LUSHA_API_KEY` | **Vercel production only** | The on-switch. Without it (or outside `VERCEL_ENV=production`) the feature is off: no control, no request, no ledger row. Removing it is the kill switch. Never set it in Preview or Development. |
| `LUSHA_DAILY_CREDIT_CAP` | production, optional | Credits the team may spend per Argentina business day. Default `12`. `0` is a soft kill switch (every spend is refused). An unparsable value fails closed to `0`. |

Changing either variable needs **one Vercel variable edit plus a redeploy**: Vercel applies environment
changes only to new deployments.

- The cap counts credits charged (or reserved, while unknown) in our own `lusha_reveal` ledger. Lusha's
  `/v3/account/usage` is eventually consistent and is shown for information only.
- Nothing is retried automatically. A failed or unreadable response keeps its reserved credits in the day's
  total; a manual retry goes through the cap again.
- Tests never call Lusha: they use fakes and the fixtures in `tests/unit/fixtures/lusha/`.
- **First phone reveal is the measurement.** The shape of Lusha's `phones[]` was never observed. The raw array is
  stored on the ledger row (`payload`), and the parser writes nothing to the Contact if it does not recognise
  the entry. After the first real phone reveal, check the stored payload and open a parser follow-up if needed;
  no second 5-credit reveal is required.

## Deployments and branches

Only two kinds of branch build on Vercel:

- `main` — the production deployment.
- `release/*` — the single preview the owner reviews before a release merges.

`feat/*`, `fix/*`, `chore/*` and `docs/*` never build (`git.deploymentEnabled`
in `vercel.json`). Work chains freely on those branches; when a chain is ready,
merge its tip into a `release/*` branch and let that one preview cover the whole
batch.

This is a build-budget rule, not a style rule. Every branch push used to trigger
its own preview build, so a chain of ~40 branches burned the daily build quota
and left every check failing with `Deployment rate limited — retry in 24 hours`,
which also blocks production deploys.

## v1 scope
- BD identity (env stand-in; Supabase Auth comes in v2)
- CSV import → parse → upsert into the BD's private base
- Filters: company, position
- Team overlap indicator (names the owning BD)

## Not in v1
AI research + message drafting (v2), LinkedIn scraping via Apify (v3, isolated).
