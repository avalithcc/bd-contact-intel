-- Supabase pg_cron + pg_net setup for /api/realtime/keepalive. Supabase keeps broadcasts (migration 0056 live updates) in daily
-- partitions of realtime.messages and private-channel authorization needs today's partition. They are created only when a client
-- joins a channel or by Supabase's janitor for recently connected projects, and we have no rights on the realtime schema. The
-- route joins a PUBLIC channel with the anon key once a day so the partition window never lapses. No data is sent or read.
-- Same shape as scripts/meetings-digest-cron.sql. Plain SQL script, NOT a Drizzle migration (reads the bearer from Vault). Run by
-- the orchestrator in the Supabase SQL Editor AFTER owner approval and only after the release with the route is deployed.
--
-- 06:00 UTC, every day. The Vault secret `gmail_sync_cron_secret` already exists and equals the app's CRON_SECRET.
-- Idempotent (safe to re-run): the first statement removes the job if it exists, the second creates it.
--
-- One-off check from any shell:
--   curl -H "Authorization: Bearer $CRON_SECRET" "https://bd-contact-intel.vercel.app/api/realtime/keepalive"
--
-- Revert:
--   select cron.unschedule('realtime-keepalive-daily');

select cron.unschedule('realtime-keepalive-daily')
where exists (select 1 from cron.job where jobname = 'realtime-keepalive-daily');

select cron.schedule(
  'realtime-keepalive-daily',
  '0 6 * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/realtime/keepalive',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'gmail_sync_cron_secret'
      )
    ),
    -- pg_net defaults to 5000 ms; match the route's maxDuration.
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify it's scheduled:
--   select jobid, schedule, command, active from cron.job where jobname = 'realtime-keepalive-daily';
-- Inspect recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'realtime-keepalive-daily') order by start_time desc limit 20;
