/**
 * Owner-run, READ-ONLY verification for fix/last-activity-utc.
 *
 * Every timestamp column here is `timestamp without time zone` holding UTC.
 * `parseDbTimestamp` (src/lib/db/timestamp.ts) is the fix: it pins an
 * offset-less raw-wire string to UTC before parsing, instead of letting
 * `new Date(str)` guess in the process's local timezone. Under `TZ=UTC`
 * (Vercel prod's own runtime timezone), that pin is a no-op — an
 * offset-less string is ALREADY read as UTC by `new Date(...)` when the
 * process itself is UTC — so this script's whole purpose is proving exactly
 * that: this fix produces byte-identical timestamps to `main`, AS LONG AS
 * it's compared under `TZ=UTC` on both sides. (Under any other timezone the
 * two WOULD legitimately differ — that difference is the bug this branch
 * fixes, not a regression to chase here.)
 *
 * Samples the raw SQL each fixed call site actually runs (capped,
 * deterministically ordered by id/key), runs the row through the real
 * `parseDbTimestamp`, and prints one deterministic JSON blob to stdout.
 * Diff two runs of this same script — one on `main`, one on this branch,
 * BOTH with `TZ=UTC` — and expect NO differences.
 *
 * NEVER writes. Runs everything inside one `accessMode: "read only"`
 * Postgres transaction (drizzle's own `BEGIN ... READ ONLY` — see
 * PgTransactionConfig), so even a bug in this script cannot write to prod;
 * Postgres itself rejects any write statement for the life of the
 * transaction.
 *
 * Usage (owner-run only, requires DATABASE_URL; refuses to run unless
 * TZ=UTC, since the whole comparison is only meaningful under a fixed
 * baseline timezone):
 *
 *   git worktree add /tmp/bd-main main
 *   (cd /tmp/bd-main && TZ=UTC npx tsx scripts/verify-last-activity-utc.ts) > /tmp/before.json
 *   TZ=UTC npx tsx scripts/verify-last-activity-utc.ts > /tmp/after.json
 *   diff /tmp/before.json /tmp/after.json   # expect: no output (identical)
 *
 * `main` does not have this script yet for older checkouts — copy this file
 * over first, or add an equivalent ad hoc raw-SQL + `new Date(...)` sampler
 * there (the raw SELECTs below are unchanged either way; only the parsing
 * function differs, which is the entire point of the comparison).
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { parseDbTimestamp } from "../src/lib/db/timestamp";

const SAMPLE_LIMIT = 20;

interface TsRow {
  [key: string]: string | Date | null;
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : parseDbTimestamp(value).toISOString();
}

async function main() {
  if (process.env.TZ !== "UTC") {
    throw new Error(
      "Refusing to run: set TZ=UTC. This script's comparison (this branch vs main) is only " +
        "meaningful when both runs share the same baseline process timezone.",
    );
  }

  const results = await db.transaction(
    async (tx) => {
      const out: Record<string, unknown> = {};

      // 1) src/lib/contacts/lastActivity.ts / listQueries.ts's per-person
      // DISTINCT ON — effectiveActivityAtSql() computed timestamptz, the
      // primary fix target for buildLastActivityEntries.
      const lastActivityRows = await tx.execute<TsRow>(sql`
        select distinct on (activity.person_id)
          activity.person_id as "personId",
          (case
            when activity.type = 'status_backfill' and (activity.metadata->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'originalAt')::timestamptz
            when activity.type = 'call' and (activity.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'occurredAt')::timestamptz
            else activity.created_at end) as "at"
        from activity
        where activity.person_id is not null
        order by activity.person_id, "at" desc
        limit ${SAMPLE_LIMIT}
      `);
      out.lastActivityByPerson = lastActivityRows.map((r) => ({ personId: r.personId, at: iso(r.at) }));

      // 2) src/lib/companies/listQueries.ts — max(effectiveActivityAtSql())
      // per company (getCompanyListPage's lastActivityAt column).
      const companyLastActivity = await tx.execute<TsRow>(sql`
        select activity.company_key as "companyKey",
          max(case
            when activity.type = 'status_backfill' and (activity.metadata->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'originalAt')::timestamptz
            when activity.type = 'call' and (activity.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (activity.metadata->>'occurredAt')::timestamptz
            else activity.created_at end) as "at"
        from activity
        where activity.company_key is not null
        group by activity.company_key
        order by activity.company_key
        limit ${SAMPLE_LIMIT}
      `);
      out.lastActivityByCompany = companyLastActivity.map((r) => ({ companyKey: r.companyKey, at: iso(r.at) }));

      // 3) src/lib/outreach/queries.ts — max(person_bd_connection.last_message_at).
      const lastMessageAt = await tx.execute<TsRow>(sql`
        select person_id as "personId", max(last_message_at) as "at"
        from person_bd_connection
        group by person_id
        order by person_id
        limit ${SAMPLE_LIMIT}
      `);
      out.lastMessageAtByPerson = lastMessageAt.map((r) => ({ personId: r.personId, at: iso(r.at) }));

      // 4) src/lib/whatsnew/queries.ts's getSyncStatus — max(sync_run.finished_at).
      const syncStatus = await tx.execute<TsRow>(sql`
        select max(finished_at) as "at" from sync_run where status = 'ok'
      `);
      out.lastSuccessfulSyncAt = iso(syncStatus[0]?.at ?? null);

      // 5) src/lib/hiring/queries.ts's getCompanyPostingsForKey —
      // job_posting.posted_at/first_seen.
      const postings = await tx.execute<TsRow>(sql`
        select id, posted_at as "postedAt", first_seen as "firstSeen"
        from job_posting
        order by id
        limit ${SAMPLE_LIMIT}
      `);
      out.jobPostings = postings.map((r) => ({
        id: r.id,
        postedAt: iso(r.postedAt),
        firstSeen: iso(r.firstSeen),
      }));

      // 6) src/lib/tasks/queries.ts's getTasksForPerson window query —
      // task.created_at/updated_at/due_at.
      const tasks = await tx.execute<TsRow>(sql`
        select id, created_at as "createdAt", updated_at as "updatedAt", due_at as "dueAt"
        from task
        order by id
        limit ${SAMPLE_LIMIT}
      `);
      out.tasks = tasks.map((r) => ({
        id: r.id,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
        dueAt: iso(r.dueAt),
      }));

      // 7) src/lib/contacts/inlineDerivedColumns.ts's parseEffectiveActivityAt
      // — the JSON (`to_json`) rendering of the same effectiveActivityAtSql()
      // expression, a DIFFERENT wire shape ('T'-separated, colon-offset)
      // than (1)/(2) above.
      const inlineJson = await tx.execute<{ personId: string; raw: { createdAt: string } | null }>(sql`
        select p.id as "personId",
          (
            select json_build_object(
              'createdAt',
              (case
                when a.type = 'status_backfill' and (a.metadata->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (a.metadata->>'originalAt')::timestamptz
                when a.type = 'call' and (a.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (a.metadata->>'occurredAt')::timestamptz
                else a.created_at end)
            )
            from activity a
            where a.person_id = p.id
            order by (case
              when a.type = 'status_backfill' and (a.metadata->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (a.metadata->>'originalAt')::timestamptz
              when a.type = 'call' and (a.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (a.metadata->>'occurredAt')::timestamptz
              else a.created_at end) desc, a.id desc
            limit 1
          ) as "raw"
        from person p
        order by p.id
        limit ${SAMPLE_LIMIT}
      `);
      out.inlineLastActivity = inlineJson.map((r) => ({
        personId: r.personId,
        at: r.raw?.createdAt ? iso(r.raw.createdAt) : null,
      }));

      return out;
    },
    { accessMode: "read only" },
  );

  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
