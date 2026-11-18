/**
 * DB reads for the tender block of the 08:30 digest. Imports `db`, so like src/lib/tasks/digestQueries.ts the decisions live
 * in the pure planner (digestPlan.ts) and these only fetch.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, tender } from "@/db/schema";
import type { ClosingTenderRow, DigestBd } from "./digestPlan";
import { tenderNotDecidedNoSql } from "./relevanceSql";

/**
 * Open, not-decided-no tenders opening within 16 days: one read for every BD. 16 is the widest warning window (14 Argentina
 * calendar days) plus the day rounding, so the planner's exact day count can never need a row this leaves out; the planner
 * re-applies the window and the relevance rule exactly. `now` goes in as an ISO string with a cast (postgres-js rejects a JS Date).
 */
export async function getClosingTendersForDigest(now: Date, limit = 500, executor: Pick<typeof db, "select"> = db): Promise<ClosingTenderRow[]> {
  const nowIso = now.toISOString();
  const rows = await executor
    .select({
      id: tender.id,
      processNumber: tender.processNumber,
      name: tender.name,
      openingAt: tender.openingAt,
      aiRelevant: tender.aiRelevant,
      aiReason: tender.aiReason,
      relevanceOverride: tender.relevanceOverride,
      ownerId: bd.id,
      ownerEmail: bd.email,
      ownerName: bd.name,
    })
    .from(tender)
    .leftJoin(bd, eq(bd.id, tender.ownerBdId))
    .where(and(sql`${tender.openingAt} >= ${nowIso}::timestamptz`, sql`${tender.openingAt} < ${nowIso}::timestamptz + interval '16 days'`, tenderNotDecidedNoSql))
    .orderBy(asc(tender.openingAt))
    .limit(limit);
  return rows.map(({ ownerId, ownerEmail, ownerName, ...t }) => ({
    ...t,
    owner: ownerId && ownerEmail && ownerName ? { bdId: ownerId, bdEmail: ownerEmail, bdName: ownerName } : null,
  }));
}

/**
 * The BDs who hear about a tender nobody owns. Same switch the Gmail reminder cron honours (`email_reminders_enabled`), which
 * is off for the e2e accounts, so a test mailbox never turns a run into a failed send. A tender's OWNER is warned regardless.
 */
export async function getTenderDigestRecipients(limit = 500, executor: Pick<typeof db, "select"> = db): Promise<DigestBd[]> {
  return executor
    .select({ bdId: bd.id, bdEmail: bd.email, bdName: bd.name })
    .from(bd)
    .where(eq(bd.emailRemindersEnabled, true))
    .orderBy(asc(bd.name))
    .limit(limit);
}
