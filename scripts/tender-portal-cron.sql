-- Supabase pg_cron + pg_net job for the COMPR.AR portal fetch (/api/tenders/portal), one daily pass in three slots.
-- Same shape as scripts/auto-prospecting-cron.sql and scripts/sequences-run-cron.sql: a plain SQL script, NOT a Drizzle
-- migration, because it reads the bearer token from Supabase Vault. Run in the Supabase SQL Editor after owner approval.
--
-- WHY ONCE A DAY
-- Owner's call, 2026-11-20: "los pliegos no van a salir tan seguidos, 1 vez al dia es mas que suficiente". The portal
-- data this caches is the process envelope - opening date, deadline for questions, guarantees, duration, circulars -
-- which changes when an organism publishes a circular, not continuously. PORTAL_REFRESH_HOURS (12) already refuses to
-- re-fetch a tender more often than that, so a second daily pass would mostly be a no-op anyway.
--
-- WHY THREE SLOTS FOR ONE DAILY PASS
-- Measured on the first real run, 2026-11-20: 9 tenders fetched in one invocation, stoppedEarly true, leftForNextRun 8;
-- the next invocation took the remaining 8 and finished. Each tender costs three sequential requests to the portal plus
-- a deliberate pause, about 4 seconds, and PORTAL_BUDGET_MS is 38s inside the route's 60s maxDuration. So ONE invocation
-- cannot cover the list and never will - the limit is the invocation, not the schedule, exactly as it was for
-- auto-prospecting. Three slots give headroom as the relevant list grows past today's 17.
--
-- WHY EXTRA SLOTS ARE FREE
-- selectDueTenders skips anything fetched in the last 12 hours, so once the pass is done every later slot returns
-- attempted 0 and makes no request to the portal at all. The freshness window, not the schedule, decides how much work
-- exists; the schedule only decides how many chances the day gets to finish it.
--
-- WHY 07:00 / 07:06 / 07:12 ARGENTINA
-- Done before auto-prospecting (07:30) and well before the task digest, whose cron says 11:30 UTC and which lands
-- around 11:55 UTC, so the ficha is current when the owner opens that mail. Argentina does not observe DST, so 10:xx
-- UTC is 07:xx ART all year. Six minutes apart is comfortably more than one run's 38s budget, so slots never overlap.
--
-- COURTESY: this reads a public government service with no login. The route is strictly sequential, paces itself
-- between tenders and sends a generic user agent. Do not raise the frequency to "catch things sooner" - nothing here
-- changes by the hour, and the politeness of this client is a property of the schedule as much as of the code.
--
-- Secret: the Vault entry NAMED `gmail_sync_cron_secret` (name only; the value, the app's CRON_SECRET, is never in this
-- file). It already exists in production.
--
-- Idempotent (safe to re-run): the unschedule is guarded by an exists check, then the job is created.
--
-- Revert:  select cron.unschedule('tender-portal-0700-art');

select cron.unschedule('tender-portal-0700-art')
where exists (select 1 from cron.job where jobname = 'tender-portal-0700-art');

select cron.schedule(
  'tender-portal-0700-art',
  '0,6,12 10 * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/tenders/portal',
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
--   select jobid, jobname, schedule, active from cron.job where jobname = 'tender-portal-0700-art';
-- Inspect recent runs:
--   select status, start_time, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'tender-portal-0700-art')
--   order by start_time desc limit 20;
-- What each invocation did (attempted / fetched / notFound / failed / stoppedEarly / leftForNextRun):
--   select status_code, content, created from net._http_response order by created desc limit 10;
-- Is the cache healthy? fetch_error should stay null and fetched_at should be today for every open relevant tender:
--   select t.process_number, p.fetched_at, p.fetch_error
--   from tender t left join tender_portal p on p.tender_id = t.id
--   where t.opening_at > now() and coalesce(t.relevance_override, t.ai_relevant) is not false
--   order by p.fetched_at nulls first;
