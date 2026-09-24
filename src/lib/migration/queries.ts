/**
 * DB-backed wiring for the collapse migration (design.md "Migration plan").
 * Deliberately NOT unit-tested directly — it imports `@/db`, which throws
 * at import time without `DATABASE_URL` (see src/lib/auth/requireAdmin.ts
 * for the same split rationale). All branching logic worth testing lives
 * in the pure modules this file wires: collapsePlanner, collapseRun,
 * executionGuard, inputHash.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  bd,
  contact,
  duplicateCandidate,
  migrationRun,
  person,
  personBdConnection,
  personIdMap,
} from "@/db/schema";
import type { CollapseContactRow, CollapsePlan } from "./collapsePlanner";
import type { CollapseRunMode } from "./collapseRun";
import type { MigrationRunForGate } from "./executionGuard";
import type { EmailStatus } from "@/lib/identity/matcher";

const READ_BATCH_SIZE = 1000;

/** Pages through `contact` (same keyset-pagination pattern as scripts/backfill-*.ts). */
export async function readAllContactRows(): Promise<CollapseContactRow[]> {
  const rows: CollapseContactRow[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(contact)
      .where(lastId === null ? undefined : sql`${contact.id} > ${lastId}`)
      .orderBy(contact.id)
      .limit(READ_BATCH_SIZE);
    if (!page.length) break;

    for (const r of page) {
      rows.push({
        id: r.id,
        bdId: r.bdId,
        profileKey: r.profileKey,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        companyKey: r.companyKey,
        companyCategory: r.companyCategory,
        roleGroup: r.roleGroup,
        position: r.position,
        industry: r.industry,
        email: r.email,
        emailStatus: r.emailStatus as EmailStatus,
        emailConfidence: r.emailConfidence,
        emailSource: r.emailSource,
        connectedOn: r.connectedOn,
      });
    }
    lastId = page[page.length - 1].id;
  }
  return rows;
}

export async function saveMigrationRun(input: {
  mode: CollapseRunMode;
  inputHash: string;
  report: CollapsePlan["report"];
}): Promise<string> {
  const [row] = await db
    .insert(migrationRun)
    .values({
      kind: "collapse",
      mode: input.mode,
      inputHash: input.inputHash,
      report: input.report,
    })
    .returning({ id: migrationRun.id });
  return row.id;
}

export async function getMigrationRunForGate(runId: string): Promise<MigrationRunForGate | null> {
  const row = await db.query.migrationRun.findFirst({ where: eq(migrationRun.id, runId) });
  if (!row) return null;
  return { approvedAt: row.approvedAt, inputHash: row.inputHash };
}

/** Left-joins the approver's name so /admin/migration doesn't show a raw bd id. */
function migrationRunWithApproverSelect() {
  return db
    .select({
      id: migrationRun.id,
      kind: migrationRun.kind,
      mode: migrationRun.mode,
      inputHash: migrationRun.inputHash,
      report: migrationRun.report,
      approvedByBdId: migrationRun.approvedByBdId,
      approverName: bd.name,
      approvedAt: migrationRun.approvedAt,
      executedAt: migrationRun.executedAt,
      createdAt: migrationRun.createdAt,
    })
    .from(migrationRun)
    .leftJoin(bd, eq(migrationRun.approvedByBdId, bd.id));
}

export type MigrationRunWithApprover = Awaited<
  ReturnType<typeof migrationRunWithApproverSelect>
>[number];

export async function listMigrationRuns(
  kind: "collapse" | "fold_leads",
): Promise<MigrationRunWithApprover[]> {
  return migrationRunWithApproverSelect()
    .where(eq(migrationRun.kind, kind))
    .orderBy(desc(migrationRun.createdAt));
}

export async function getLatestMigrationRun(
  kind: "collapse" | "fold_leads",
): Promise<MigrationRunWithApprover | null> {
  const runs = await migrationRunWithApproverSelect()
    .where(eq(migrationRun.kind, kind))
    .orderBy(desc(migrationRun.createdAt))
    .limit(1);
  return runs[0] ?? null;
}

/** `/admin/migration`'s "Approve dry run" action (admin-access-audit spec). */
export async function approveMigrationRun(runId: string, approvedByBdId: string) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(migrationRun)
      .set({ approvedByBdId, approvedAt: new Date() })
      .where(eq(migrationRun.id, runId))
      .returning();
    if (!updated) throw new Error(`migration_run ${runId} not found`);
    await tx.insert(auditLog).values({
      actorBdId: approvedByBdId,
      action: "migration_approve",
      metadata: { migrationRunId: runId, kind: updated.kind },
    });
    return updated;
  });
}

/**
 * Writes a collapse plan for real. Only ever called from the `--execute`
 * path in scripts/unify-contacts.ts, after assertExecutionAllowed has
 * passed (src/lib/migration/collapseRun.ts#runCollapseExecute) — never
 * from the dry-run path.
 */
export async function writeCollapsePlan(plan: CollapsePlan, migrationRunId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const realIdByPlanId = new Map<string, string>();

    for (const p of plan.persons) {
      const [row] = await tx
        .insert(person)
        .values({
          profileKey: p.profileKey,
          firstName: p.merged.firstName,
          lastName: p.merged.lastName,
          email: p.merged.email,
          emailNormalized: p.merged.emailNormalized,
          emailStatus: p.merged.emailStatus,
          emailConfidence: p.merged.emailConfidence,
          emailSource: p.merged.emailSource,
          company: p.merged.company,
          companyKey: p.merged.companyKey,
          companyCategory: p.merged.companyCategory,
          jobTitle: p.merged.jobTitle,
          roleGroup: p.merged.roleGroup,
          industry: p.merged.industry,
          ownerBdId: p.ownerBdId,
          sourceKey: "linkedin_import",
          migrationRunId,
        })
        .returning({ id: person.id });
      realIdByPlanId.set(p.planId, row.id);

      for (const c of p.connections) {
        await tx.insert(personBdConnection).values({
          personId: row.id,
          bdId: c.bdId,
          connectedOn: c.connectedOn,
          legacyContactId: c.legacyContactId,
        });
      }
      for (const mapping of p.legacyMappings) {
        await tx.insert(personIdMap).values({
          legacyTable: "contact",
          legacyId: mapping.legacyContactId,
          personId: row.id,
          method: mapping.method,
          migrationRunId,
        });
      }
    }

    for (const skip of plan.ownCompanySkipped) {
      await tx.insert(personIdMap).values({
        legacyTable: "contact",
        legacyId: skip.legacyContactId,
        personId: null,
        method: "skipped_own_company",
        migrationRunId,
      });
    }

    for (const pair of plan.reviewPairs) {
      const a = realIdByPlanId.get(pair.planIdA);
      const b = realIdByPlanId.get(pair.planIdB);
      if (!a || !b) continue;
      const [personAId, personBId] = a < b ? [a, b] : [b, a];
      await tx
        .insert(duplicateCandidate)
        .values({ personAId, personBId, reason: pair.reason, matchKey: pair.matchKey })
        .onConflictDoNothing();
    }
  });
}
