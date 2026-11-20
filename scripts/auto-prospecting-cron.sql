-- Supabase pg_cron + pg_net job for the auto-prospecting run (/api/prospecting/run), three slots every morning.
-- Same shape as scripts/sequences-run-cron.sql and scripts/gmail-sync-cron.sql: a plain SQL script, NOT a Drizzle
-- migration, because it reads the bearer token from Supabase Vault. Run in the Supabase SQL Editor after owner approval.
--
-- WHY THREE SLOTS AND NOT A BIGGER CAP
-- The first scheduled run (2026-11-20 07:30 ART) reported: drafted 4, deferred 6 (daily_cap), stoppedEarly true,
-- leftForNextRun 4. The planner had allocated all 8 of the day's cap, and the consumer reached only 4 of them before
-- AUTO_PROSPECTING_BUDGET_MS (45 s, inside the route's 60 s maxDuration) expired. So the binding constraint was never
-- AUTO_PROSPECTING_DAILY_CAP - it was the wall clock of ONE invocation, and raising the cap would not have moved a
-- single draft. The job this replaces said so itself: "a non-zero leftForNextRun on consecutive days means the backlog
-- is not draining and the schedule needs a second slot, not a bigger cap."
--
-- WHY EXTRA SLOTS CANNOT OVERSHOOT THE CAP
-- readDraftedToday (consumer.ts) counts prospect_draft rows with outcome='drafted' since the start of the ARGENTINA day,
-- per BD, and planProspectRun refuses past AUTO_PROSPECTING_DAILY_CAP. So slot 2 sees what slot 1 wrote and plans only
-- the remainder; once the day's cap is reached every later slot defers with reason daily_cap and makes NO model call.
-- The cap, not the schedule, decides how many drafts a day holds - the schedule only decides how many chances the day
-- gets to reach it. A slot that drafts nothing also writes no audit_log row (cronRun.ts only audits when it wrote).
--
-- WHY 07:30 / 07:40 / 07:50 ARGENTINA
-- After the hiring sync (09:00 UTC) so the morning's fresh postings are drafted the same day, and finished well before
-- the task digest, whose cron says 11:30 UTC and which actually lands around 11:55 UTC: the drafts are already in the
-- Sequence when that mail is opened. Argentina does not observe DST, so 10:xx UTC is 07:xx ART all year.
-- Ten minutes apart is far more than the 45 s budget plus pg_net's 60 s timeout, so two slots never overlap.
--
-- NOTE: the run acts AS the single admin BD. With zero or more than one admin it refuses with a 500 and does nothing.
--
-- Secret: the Vault entry NAMED `gmail_sync_cron_secret` (name only; the value, the app's CRON_SECRET, is never in this
-- file). It already exists in production, so nothing needs to be created first.
--
-- Idempotent (safe to re-run): each unschedule is guarded by an exists check, then the job is created.
--
-- Revert to the single 07:30 slot:
--   select cron.unschedule('auto-prospecting-0730-0750-art');
--   select cron.schedule('auto-prospecting-daily-0730-art', '30 10 * * *', $$ ...the body below, unchanged... $$);

-- The single-slot job this replaces. Named explicitly because the rename is the point: a job called "daily-0730" that
-- fires three times would be a name that lies, and the schedule is the first thing anyone reads when it misbehaves.
select cron.unschedule('auto-prospecting-daily-0730-art')
where exists (select 1 from cron.job where jobname = 'auto-prospecting-daily-0730-art');

select cron.unschedule('auto-prospecting-0730-0750-art')
where exists (select 1 from cron.job where jobname = 'auto-prospecting-0730-0750-art');

select cron.schedule(
  'auto-prospecting-0730-0750-art',
  '30,40,50 10 * * *',
  $$
  select net.http_get(
    url := 'https://bd-contact-intel.vercel.app/api/prospecting/run',
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
--   select jobid, jobname, schedule, active from cron.job where jobname like 'auto-prospecting%';
-- Inspect recent runs:
--   select status, start_time, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'auto-prospecting-0730-0750-art')
--   order by start_time desc limit 20;
-- What each run actually did (counts, stoppedEarly, leftForNextRun):
--   select at, metadata from audit_log where action = 'auto_prospecting_run' order by at desc limit 10;
-- Is the backlog draining? leftForNextRun should reach 0, and this should trend down:
--   select count(*) from signal where source = 'hiring' and consumed_at is null;
