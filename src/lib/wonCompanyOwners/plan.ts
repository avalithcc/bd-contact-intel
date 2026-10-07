/**
 * Pure planner behind scripts/assign-won-company-owners.ts: which won companies
 * have no owner yet, and the company_property_history rows to write for them.
 * Assign-if-NULL only: a company that already has an owner is never touched.
 * Never mutates its inputs.
 */
import { isUuid } from "@/lib/uuid";

export const WON_STAGE = "won";
/** An owner-run bulk this large means the selection is wrong, not that the data is. */
export const OWNER_ASSIGN_CAP = 500;
/** Import/admin flavoured: 'edit' on an owner means "manually set" elsewhere. */
export const WON_OWNER_HISTORY_SOURCE = "import";

export interface WonCompanyRow {
  companyKey: string;
  relationshipStage: string | null;
  ownerBdId: string | null;
}

export interface WonOwnerPlan {
  assignments: { companyKey: string }[];
  historyRows: { companyKey: string; property: "ownerBdId"; oldValue: null; newValue: string; source: string }[];
  report: { wonTotal: number; alreadyOwned: number; toAssign: number };
}

export function planWonOwnerAssignments(rows: readonly WonCompanyRow[], ownerBdId: string): WonOwnerPlan {
  if (!isUuid(ownerBdId)) throw new Error("Owner must be a bd uuid.");
  const won = rows.filter((r) => r.relationshipStage === WON_STAGE);
  const assignments = won.filter((r) => r.ownerBdId === null).map((r) => ({ companyKey: r.companyKey }));
  if (assignments.length > OWNER_ASSIGN_CAP) throw new Error(`${assignments.length} companies to assign exceeds the cap of ${OWNER_ASSIGN_CAP}: refusing.`);
  return {
    assignments,
    historyRows: assignments.map((a) => ({ companyKey: a.companyKey, property: "ownerBdId" as const, oldValue: null, newValue: ownerBdId, source: WON_OWNER_HISTORY_SOURCE })),
    report: { wonTotal: won.length, alreadyOwned: won.length - assignments.length, toAssign: assignments.length },
  };
}
