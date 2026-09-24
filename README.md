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
npm run db:push           # create tables
npm run dev               # http://localhost:3000
```

Also set `CRON_SECRET` (a random string) as an env var in the deployment
environment (e.g. Vercel project settings) — it authenticates the
`/api/hiring/sync` cron endpoint. That route fails closed if it's unset.

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
1. `npm run db:push` (or apply `drizzle/0006_job_posting_market.sql`
   manually) — adds `job_posting.market` + its index.
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
- Check that the new entry's `when` is greater than every previous one (the
  older entries carry hand-set, future-dated timestamps); bump it if not.
- Vercel does not run migrations. Apply them by hand with
  `node --env-file=.env.local node_modules/.bin/drizzle-kit migrate`.
- Never trust the success message: verify the objects exist afterwards, e.g.
  `select to_regclass('public.<table>')`.
- Don't use `drizzle-kit push` against production: it changes the schema
  without recording anything in the ledger.

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

## v1 scope
- BD identity (env stand-in; Supabase Auth comes in v2)
- CSV import → parse → upsert into the BD's private base
- Filters: company, position
- Team overlap indicator (names the owning BD)

## Not in v1
AI research + message drafting (v2), LinkedIn scraping via Apify (v3, isolated).
