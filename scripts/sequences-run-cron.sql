-- Supabase pg_cron + pg_net job for the Sequence release runner (/api/sequences/run), every minute (send-now-or-schedule).
-- Same shape as scripts/meetings-digest-cron.sql and openspec/changes/scheduled-send/pg_cron.sql: a plain SQL script, NOT a
-- Drizzle migration, because it reads the bearer token from Supabase Vault. Run by the orchestrator in the Supabase SQL Editor
-- AFTER owner approval and AFTER the release that contains "Enviar ahora / Programar…" for Sequences is deployed. Not applied by
-- the branch that adds it.
--
-- Why: Vercel Hobby crons are daily-only, so the two crons in vercel.json (13:00 and 14:00 UTC) are the only ticks today. A
-- member approved with "Enviar ahora" or a chosen time is released by the first tick at or after its moment: with this job that
-- is within a minute; without it, up to a day. The two Vercel crons STAY as a daily fallback.
--
-- Safe to call every minute:
--  * Idempotent. A member is released only through the at-most-once claim (an INSERT ... ON CONFLICT DO NOTHING taken before
--    the Gmail call), so overlapping runs, a retried request or the Vercel cron firing at the same minute cannot double-send.
--  * Cheap when nothing is due. The run reads ONE statement (approved steps whose moment has passed); the per-account daily
--    counts and the suppression list are only read when that statement returns something.
--  * The daily cap and every pre-send check still apply to each send, whichever tick picks it up.
--
-- The route is GET-only (like /api/gmail/sync), hence net.http_get, and its maxDuration is 300 s; pg_net's timeout below is 60 s
-- (the request is abandoned by pg_net after that; the run itself keeps going on the server and the claim keeps it safe).
--
-- Secret: the Vault entry NAMED `gmail_sync_cron_secret` (name only; the value, the app's CRON_SECRET, is never in this file).
-- It already exists in production, so nothing needs to be created first.
--
-- Idempotent (safe to re-run): the first statement removes the job if it exists, the second creates it.
--
-- Revert:  select cron.unschedule('sequences-run-every-minute');

select cron.unschedule('sequences-run-every-minute')
where exists (select 1 from cron.job where jobname = 'sequences-run-every-minute');

select cron.schedule(
  'sequences-run-every-minute',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/sequences/run',
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

-- Verify it's scheduled:
--   select jobid, schedule, command, active from cron.job where jobname = 'sequences-run-every-minute';
-- Inspect recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'sequences-run-every-minute') order by start_time desc limit 20;
-- What the route did (the run log line `sequence_release_run` carries released / held / deferred / failed per run):
--   select * from net._http_response order by created desc limit 20;
