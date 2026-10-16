-- Supabase pg_cron + pg_net job for the scheduled-send dispatcher (/api/email/scheduled/run).
-- Same shape as scripts/gmail-sync-cron.sql: a plain SQL script, NOT a Drizzle migration, because it reads a secret from
-- Supabase Vault. Run by the orchestrator in the Supabase SQL Editor AFTER owner approval and AFTER migration 0049 and the
-- code are deployed. Not applied by this branch.
--
-- Vercel Hobby crons are daily-only, so the every-minute cadence lives here. The route is GET-only (like /api/gmail/sync),
-- hence net.http_get.
--
-- Secret: the Vault entry NAMED `gmail_sync_cron_secret` (name only; the value, the app's CRON_SECRET, is never in this
-- file). It already exists in production (see scripts/gmail-sync-cron.sql), so nothing needs to be created first.
--
-- Overlap: the route's maxDuration is 60 s and pg_net's timeout below is 60 s, so a run cannot outlive the 1-minute
-- interval by much; if one does, the claim (`for update skip locked`) keeps the two runs from taking the same row.
--
-- Revert:  select cron.unschedule('scheduled-email-every-minute');

select cron.unschedule('scheduled-email-every-minute')
where exists (select 1 from cron.job where jobname = 'scheduled-email-every-minute');

select cron.schedule(
  'scheduled-email-every-minute',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/email/scheduled/run',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'gmail_sync_cron_secret'
      )
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Smoke test BEFORE relying on it (counts only, claims nothing):
--   curl -H "Authorization: Bearer $CRON_SECRET" "https://bd-contact-intel.vercel.app/api/email/scheduled/run?dryRun=1"
-- Verify it's scheduled:
--   select jobid, schedule, command, active from cron.job where jobname = 'scheduled-email-every-minute';
-- Inspect recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'scheduled-email-every-minute') order by start_time desc limit 20;
