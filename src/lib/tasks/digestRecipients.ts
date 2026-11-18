/**
 * Who gets a digest email: the UNION of BDs with due tasks, BDs with expiring follow-ups and BDs with closing tenders. Pure.
 * The route once built this from tasks alone, so a BD with no tasks got nothing, and that is the BD who needs a deadline warning.
 */
import type { DigestFollowUpDbRow, DigestTaskRow } from "@/lib/tasks/digestQueries";
import type { PlannedBd } from "@/lib/tenders/digestPlan";
import { NO_TENDERS, type DigestTenders } from "@/lib/tasks/digestTenders";
import type { DigestTask } from "@/lib/tasks/digest";

/** Groups already-fetched rows by `bdId`, preserving each BD's row order. */
export function groupDigestTaskRowsByBd(rows: readonly DigestTaskRow[]): Map<string, DigestTaskRow[]> {
  const byBd = new Map<string, DigestTaskRow[]>();
  for (const row of rows) {
    const existing = byBd.get(row.bdId);
    if (existing) existing.push(row);
    else byBd.set(row.bdId, [row]);
  }
  return byBd;
}

export interface DigestRecipient {
  bdEmail: string;
  bdName: string;
  tasks: DigestTask[];
  tenders: DigestTenders;
}

export function buildDigestRecipients(
  tasksByBd: ReadonlyMap<string, readonly DigestTaskRow[]>,
  followUpsByBd: ReadonlyMap<string, readonly DigestFollowUpDbRow[]>,
  tenderPlan: ReadonlyMap<string, PlannedBd>,
): Map<string, DigestRecipient> {
  const out = new Map<string, DigestRecipient>();
  for (const [bdId, rows] of tasksByBd) out.set(bdId, { bdEmail: rows[0]!.bdEmail, bdName: rows[0]!.bdName, tasks: [...rows], tenders: NO_TENDERS });
  for (const [bdId, rows] of followUpsByBd) if (!out.has(bdId)) out.set(bdId, { bdEmail: rows[0]!.bdEmail, bdName: rows[0]!.bdName, tasks: [], tenders: NO_TENDERS });
  for (const [bdId, p] of tenderPlan) {
    const existing = out.get(bdId);
    if (existing) existing.tenders = p.tenders;
    else out.set(bdId, { bdEmail: p.bdEmail, bdName: p.bdName, tasks: [], tenders: p.tenders });
  }
  return out;
}
