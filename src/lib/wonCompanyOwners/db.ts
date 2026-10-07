/**
 * Thin DB layer for scripts/assign-won-company-owners.ts; the decisions live in
 * plan.ts. Two reads: the target bd, and the won companies (one query, capped).
 * Dry run is a READ ONLY transaction. Execute re-reads and re-plans inside one
 * transaction, assigns only where owner_bd_id is still NULL (re-checked in SQL,
 * a mismatch aborts everything), writes the history rows and ONE audit_log row.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, company, companyPropertyHistory } from "@/db/schema";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { planWonOwnerAssignments, WON_OWNER_HISTORY_SOURCE, WON_STAGE, type WonOwnerPlan } from "./plan";

export const WON_OWNER_AUDIT_ACTION = "assign_won_company_owners";
const READ_CAP = 5_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadPlan(tx: DbTransaction, ownerBdId: string): Promise<WonOwnerPlan> {
  if (!isUuid(ownerBdId)) throw new Error("--owner must be a bd uuid.");
  const [owner] = await tx.select({ id: bd.id }).from(bd).where(eq(bd.id, ownerBdId)).limit(1);
  if (!owner) throw new Error("--owner is not a row in bd: refusing to assign.");
  const rows = await tx
    .select({ companyKey: company.companyKey, relationshipStage: company.relationshipStage, ownerBdId: company.ownerBdId })
    .from(company)
    .where(eq(company.relationshipStage, WON_STAGE))
    .limit(READ_CAP + 1);
  if (rows.length > READ_CAP) throw new Error(`More than ${READ_CAP} won companies: refusing to plan against a truncated set.`);
  return planWonOwnerAssignments(rows, ownerBdId);
}

export async function dryRunWonOwners(ownerBdId: string): Promise<WonOwnerPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return loadPlan(tx, ownerBdId);
  });
}

export async function executeWonOwners(ownerBdId: string, actorBdId: string): Promise<{ plan: WonOwnerPlan; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) => {
    const plan = await loadPlan(tx, ownerBdId);
    if (!plan.assignments.length) return { plan, auditLogId: null };

    for (const batch of chunk(plan.assignments, WRITE_BATCH_SIZE)) {
      const keys = batch.map((a) => sql`${a.companyKey}`);
      const updated = (await tx.execute(sql`
        update company set owner_bd_id = ${ownerBdId}::uuid, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        where company_key in (${sql.join(keys, sql`, `)}) and relationship_stage = ${WON_STAGE} and owner_bd_id is null
        returning company_key
      `)) as unknown as unknown[];
      if (updated.length !== batch.length) throw new Error(`Expected to assign ${batch.length} companies, assigned ${updated.length}: an owner appeared since the plan was built.`);
    }
    for (const batch of chunk(plan.historyRows, WRITE_BATCH_SIZE)) await tx.insert(companyPropertyHistory).values(batch.map((h) => ({ ...h, changedByBdId: actorBdId })));

    const [audit] = await tx
      .insert(auditLog)
      .values({
        actorBdId,
        action: WON_OWNER_AUDIT_ACTION,
        targetBdId: ownerBdId,
        // Revert: set owner_bd_id back to NULL for these keys where it still equals ownerBdId, then delete
        // their company_property_history rows (property 'ownerBdId', source 'import', at >= this row's time).
        metadata: { ownerBdId, report: plan.report, companyKeys: plan.assignments.map((a) => a.companyKey), historySource: WON_OWNER_HISTORY_SOURCE },
      })
      .returning({ id: auditLog.id });
    return { plan, auditLogId: audit!.id };
  });
}
