-- Supabase pg_cron + pg_net setup for /api/gmail/sync (email-sync brief,
-- owner decision 2026-09-30: "Supabase pg_cron + pg_net calls
-- /api/gmail/sync every 15 minutes"). This is a plain SQL script, NOT a
-- Drizzle migration, because it reads a secret from Supabase Vault — a
-- migration file would either bake the secret in as plaintext or need a
-- templating step Drizzle doesn't have. Run by the orchestrator, in the
-- Supabase SQL Editor, AFTER owner approval. Not applied by this branch.
--
-- Uses `net.http_get`, not `net.http_post`: /api/gmail/sync
-- (src/app/api/gmail/sync/route.ts) only exports a GET handler, so a POST
-- would 405. In production, the `pg_cron` extension, the `pg_net` extension,
-- and the `gmail_sync_cron_secret` Vault secret were already provisioned via
-- SQL (not the dashboard steps below) on 2026-09-30 — this script documents
-- the equivalent manual path for a fresh environment and matches what
-- production actually runs.
--
-- One-time manual dashboard steps BEFORE running this script (skip if the
-- extensions/secret already exist, as they do in production):
--
--   1. Database -> Extensions -> enable `pg_cron`.
--   2. Database -> Extensions -> enable `pg_net`.
--   3. Project Settings -> Vault -> "New secret":
--        name:  gmail_sync_cron_secret
--        value: the same value as the app's CRON_SECRET env var (Vercel ->
--               Project Settings -> Environment Variables). This is the
--               bearer token every existing cron route already checks
--               (src/lib/cronAuth.ts) — reusing it means no new secret to
--               provision on the app side.
--
-- Then run the two statements below (idempotent — safe to re-run).
--
-- Revert:
--   select cron.unschedule('gmail-sync-every-15-min');

select cron.schedule(
  'gmail-sync-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/gmail/sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'gmail_sync_cron_secret'
      )
    ),
    -- pg_net defaults to 5000 ms; a sync run takes ~20 s, so the default
    -- recorded a timeout on every backfill run (2026-09-30). Match the
    -- route's maxDuration.
    timeout_milliseconds := 60000
  );
  $$
);

-- Verify it's scheduled:
--   select jobid, schedule, command, active from cron.job where jobname = 'gmail-sync-every-15-min';
-- Inspect recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'gmail-sync-every-15-min') order by start_time desc limit 20;
