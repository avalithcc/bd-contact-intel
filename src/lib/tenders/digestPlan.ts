/**
 * Which tender reaches which BD in the 08:30 digest. Pure: no I/O, never mutates its inputs.
 *
 * Tenders are admin-only (owner, 2026-11-18): the section and this digest are one permission, so a non-admin never gets a
 * tender line, whatever they own. A tender is lost by its deadline passing, so the rule is about who can still act. An ADMIN
 * owner is warned from 7 days out. A relevant tender with NO admin owner (none, or one who is not an admin and cannot open it)
 * goes to every admin, from 14 days out (nobody has started on it, so the window is wider). Closed tenders never appear. "Relevant" is `tenderRelevance` (relevance.ts), the one definition:
 * a human's call beats the model's, and an unclassified tender is included because a failed model call must not hide a deadline.
 */
import type { DigestTender, DigestTenders } from "@/lib/tasks/digestTenders";
import { isAdminRole } from "@/lib/auth/adminRole";
import { tenderRelevance, type RelevanceColumns } from "./relevance";
import { tenderTiming } from "./timing";

export const TENDER_OWN_WINDOW_DAYS = 7;
export const TENDER_UNOWNED_WINDOW_DAYS = 14;

export interface DigestBd {
  bdId: string;
  bdEmail: string;
  bdName: string;
  /** `bd.role`: only an admin is ever planned a tender line. */
  bdRole: string;
}

export interface ClosingTenderRow extends RelevanceColumns {
  id: string;
  processNumber: string;
  name: string;
  openingAt: Date;
  owner: DigestBd | null;
}

export interface PlannedBd extends DigestBd {
  tenders: DigestTenders;
}

/** `everyone` are the BDs that receive the unowned warning; non-admins in it are ignored. An admin owner is added from the row itself even when absent from it. */
export function planTenderDigest(rows: readonly ClosingTenderRow[], everyone: readonly DigestBd[], now: Date): Map<string, PlannedBd> {
  const plan = new Map<string, PlannedBd>();
  const slot = (bd: DigestBd): PlannedBd => {
    let p = plan.get(bd.bdId);
    if (!p) plan.set(bd.bdId, (p = { ...bd, tenders: { mine: [], unowned: [] } }));
    return p;
  };
  const unowned: DigestTender[] = [];
  const sorted = rows.map((r) => ({ r, timing: tenderTiming(r.openingAt, now) })).sort((a, b) => a.r.openingAt.getTime() - b.r.openingAt.getTime());
  for (const { r, timing } of sorted) {
    if (timing.closed || tenderRelevance(r).state === "irrelevant") continue;
    const item: DigestTender = { id: r.id, processNumber: r.processNumber, name: r.name, openingAt: r.openingAt, daysLeft: timing.daysLeft };
    if (r.owner && isAdminRole({ role: r.owner.bdRole })) {
      if (timing.daysLeft <= TENDER_OWN_WINDOW_DAYS) slot(r.owner).tenders.mine.push(item);
    } else if (timing.daysLeft <= TENDER_UNOWNED_WINDOW_DAYS) {
      unowned.push(item);
    }
  }
  if (unowned.length > 0) for (const bd of everyone) if (isAdminRole({ role: bd.bdRole })) slot(bd).tenders.unowned = [...unowned];
  return plan;
}
