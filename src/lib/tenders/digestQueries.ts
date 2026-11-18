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
      ownerRole: bd.role,
    })
    .from(tender)
    .leftJoin(bd, eq(bd.id, tender.ownerBdId))
    .where(and(sql`${tender.openingAt} >= ${nowIso}::timestamptz`, sql`${tender.openingAt} < ${nowIso}::timestamptz + interval '16 days'`, tenderNotDecidedNoSql))
    .orderBy(asc(tender.openingAt))
    .limit(limit);
  return rows.map(({ ownerId, ownerEmail, ownerName, ownerRole, ...t }) => ({
    ...t,
    owner: ownerId && ownerEmail && ownerName && ownerRole ? { bdId: ownerId, bdEmail: ownerEmail, bdName: ownerName, bdRole: ownerRole } : null,
  }));
}

/**
 * The BDs who hear about a tender nobody owns: every admin. Deliberately NOT filtered by `email_reminders_enabled`: that switch
 * exists to quiet BD task reminders (and keeps the e2e mailboxes quiet, which are not admins), and a public-tender deadline is
 * not that noise. With no admin at all nobody is warned; that is a data problem to see, not a reason to mail BDs who cannot
 * open the section. A tender's admin OWNER is warned regardless.
 */
export async function getTenderDigestRecipients(limit = 500, executor: Pick<typeof db, "select"> = db): Promise<DigestBd[]> {
  return executor
    .select({ bdId: bd.id, bdEmail: bd.email, bdName: bd.name, bdRole: bd.role })
    .from(bd)
    .where(eq(bd.role, "admin"))
    .orderBy(asc(bd.name))
    .limit(limit);
}
