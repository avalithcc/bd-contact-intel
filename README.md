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

## v1 scope
- BD identity (env stand-in; Supabase Auth comes in v2)
- CSV import → parse → upsert into the BD's private base
- Filters: company, position
- Team overlap indicator (names the owning BD)

## Not in v1
AI research + message drafting (v2), LinkedIn scraping via Apify (v3, isolated).
