/**
 * Auto-prospecting producer: an IT posting appears at a company where we can actually act, so a `hiring` signal is written.
 *
 * "Can act" = the company has a person with a VERIFIED email (never probable) in a decision-making role (LEADERSHIP_ROLE_GROUPS).
 * The posting that justifies the signal rides in `data` (never under `body`: readers of person signals treat `data.body` as prompt text).
 *
 * Idempotent by the database, not by this SELECT: `signal_hiring_posting_unique` (drizzle/0070) is the arbiter, so two overlapping runs
 * cannot write the same posting twice. One signal per company per FRESH_POSTING_WINDOW_DAYS keeps one hot company from becoming ten drafts.
 * One statement + one audit_log row in one transaction; revert = delete the signal ids listed in the audit row (cascades to prospect_draft).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { FRESH_POSTING_WINDOW_DAYS, openFreshPostingSql } from "@/lib/hiring/openPosting";
import { LEADERSHIP_ROLE_GROUPS } from "@/lib/hiring/leadership";

export const PRODUCER_RUN_CAP = 100;
export const AUTO_PROSPECTING_SIGNALS_ACTION = "auto_prospecting_signals";

const roleList = () => sql.join(LEADERSHIP_ROLE_GROUPS.map((g) => sql`${g}`), sql`, `);

/**
 * A reachable decision-maker at the target company `ck`, matched through aliases like getCompanyPostingsForKey does.
 * "Reachable" is DRAFTABLE_EMAIL_STATUSES (see plan.ts): verified or probable, because a human reviews every draft
 * before it can be sent. It must stay in step with the planner's gate 1 - a signal produced for someone the planner
 * will then refuse is wasted work, and the reverse silently hides opportunities.
 */
export const verifiedLeaderAtSql = (p: string, ck: string) => {
  const person = sql.raw(p);
  const key = sql.raw(ck);
  return sql`${person}.merged_into_id is null and ${person}.email_status in ('verified', 'probable') and ${person}.role_group in (${roleList()})
    and (${person}.company_key = ${key} or exists (select 1 from company_alias ca where ca.alias_key = ${person}.company_key and ca.company_key = ${key}))`;
};

const DRY_RUN_ROLLBACK = Symbol("dry run");

/** `execute: false` runs the real statement and rolls it back, so the count is exactly what an execute would write. */
export async function produceHiringSignals(actorBdId: string, opts: { execute: boolean; limit?: number }): Promise<string[]> {
  const cap = Math.min(Math.max(1, Math.floor(opts.limit ?? PRODUCER_RUN_CAP)), PRODUCER_RUN_CAP);
  let produced: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        insert into signal (company_key, source, data)
        select jp.company_key, 'hiring', jsonb_build_object('postingId', jp.id::text, 'title', jp.title, 'location', jp.location, 'url', jp.url, 'postedAt', jp.posted_at)
        from (
          select distinct on (jp0.company_key) jp0.*
          from job_posting jp0
          where jp0.is_it = true and ${openFreshPostingSql("jp0")}
          order by jp0.company_key, jp0.posted_at desc nulls last, jp0.id
        ) jp
        where exists (select 1 from company c where c.company_key = jp.company_key)
          and exists (select 1 from person pe where ${verifiedLeaderAtSql("pe", "jp.company_key")})
          and not exists (
            select 1 from signal s
            where s.source = 'hiring' and s.company_key = jp.company_key and s.created_at > now() - ${sql.raw(`interval '${FRESH_POSTING_WINDOW_DAYS} days'`)}
          )
        order by jp.posted_at desc nulls last, jp.id
        limit ${cap}
        on conflict ((data->>'postingId')) where source = 'hiring' do nothing
        returning id::text as id
      `);
      produced = Array.from(rows, (r) => r.id);
      if (!opts.execute) throw DRY_RUN_ROLLBACK;
      if (produced.length > 0) {
        await tx.insert(auditLog).values({
          actorBdId,
          action: AUTO_PROSPECTING_SIGNALS_ACTION,
          // Revert: delete from signal where id in (signalIds). It cascades to prospect_draft; nothing was ever sent.
          metadata: { signalIds: produced, count: produced.length },
        });
      }
    });
  } catch (err) {
    if (err !== DRY_RUN_ROLLBACK) throw err;
  }
  return produced;
}
