-- Supabase pg_cron + pg_net setup for /api/meetings/digest (meeting-outcomes: the 18:00 Argentina email listing the BD's meetings
-- of today that are still unconfirmed). Same shape as scripts/gmail-sync-cron.sql and for the same reason: Vercel Hobby crons
-- run once a day at a time Vercel picks, and this email must go out at 18:00 Argentina. It is a plain SQL script, NOT a Drizzle
-- migration, because it reads the bearer token from Supabase Vault. Run by the orchestrator in the Supabase SQL Editor AFTER
-- owner approval, and only after the release that contains the route is deployed. Not applied by the branch that adds it.
--
-- 21:00 UTC = 18:00 America/Argentina/Buenos_Aires (fixed UTC-3, no DST since 2009), every day. The route sends only to a BD that
-- has at least one meeting of today still unconfirmed, at most once per BD per Argentina day, so a retried or late run is harmless.
--
-- The Vault secret `gmail_sync_cron_secret` already exists in production and holds the same value as the app's CRON_SECRET env
-- var (the bearer token every cron route checks, src/lib/cronAuth.ts); this job reuses it, so there is no new secret to
-- provision. In a fresh environment create it first (Project Settings -> Vault -> New secret) with the CRON_SECRET value.
--
-- Uses `net.http_get`: the route only exports GET.
--
-- Idempotent (safe to re-run): the first statement removes the job if it exists, the second creates it.
--
-- Preview without sending (one-off, from any shell):
--   curl -H "Authorization: Bearer $CRON_SECRET" "https://bd-contact-intel.vercel.app/api/meetings/digest?dryRun=1"
--
-- Revert:
--   select cron.unschedule('meetings-digest-18-art');

select cron.unschedule('meetings-digest-18-art')
where exists (select 1 from cron.job where jobname = 'meetings-digest-18-art');

select cron.schedule(
  'meetings-digest-18-art',
  '0 21 * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/meetings/digest',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'gmail_sync_cron_secret'
      )
    ),
    -- pg_net defaults to 5000 ms; match the route's maxDuration.
    timeout_milliseconds := 60000
  );
  $$
);

-- Verify it's scheduled:
--   select jobid, schedule, command, active from cron.job where jobname = 'meetings-digest-18-art';
-- Inspect recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'meetings-digest-18-art') order by start_time desc limit 20;
-- What the route sent (one row per BD per day):
--   select send_date, status, subject, today_count, older_count, error from meeting_digest_send order by created_at desc limit 20;
