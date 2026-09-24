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
import type { ApprovedMigrationRun, FinalizeExecuteInput } from "./collapseRun";
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

/** Persists a fresh `dry_run` migration_run row (collapseRun.ts#runCollapseDryRun's only port call). */
export async function saveDryRunReport(input: {
  inputHash: string;
  report: CollapsePlan["report"];
}): Promise<string> {
  const [row] = await db
    .insert(migrationRun)
    .values({
      kind: "collapse",
      mode: "dry_run",
      inputHash: input.inputHash,
      report: input.report,
    })
    .returning({ id: migrationRun.id });
  return row.id;
}

/** Fetches the run `--execute --run=<id>` was pointed at, for assertExecutionAllowed. */
export async function getMigrationRunForGate(runId: string): Promise<ApprovedMigrationRun | null> {
  const row = await db.query.migrationRun.findFirst({ where: eq(migrationRun.id, runId) });
  if (!row) return null;
  return {
    id: row.id,
    approvedAt: row.approvedAt,
    executedAt: row.executedAt,
    approvedByBdId: row.approvedByBdId,
    inputHash: row.inputHash,
  };
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
 * Fresh-review fix: writes a collapse plan for real, marks the SAME
 * approved migration_run row as executed (never creates a second, orphaned
 * row — see collapseRun.ts#ApprovedMigrationRun), and writes one
 * `audit_log(migration_execute)` entry recording the actor, the backup
 * path, and the report counts — all in ONE transaction. Only ever called
 * from `runCollapseExecute`, after `assertExecutionAllowed` and
 * `snapshotBackup` have both succeeded.
 */
export async function finalizeExecute(input: FinalizeExecuteInput): Promise<void> {
  const { plan, migrationRunId, actorBdId, backupPath } = input;
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

    // Link back to the approved dry run rather than orphaning a new row —
    // the backup path is folded into the existing jsonb `report` column
    // (re-derived report content is identical to the dry run's, since
    // assertExecutionAllowed already proved the input_hash matches) rather
    // than adding a dedicated schema column for this one field.
    const [updatedRun] = await tx
      .update(migrationRun)
      .set({ mode: "execute", executedAt: new Date(), report: { ...plan.report, backupPath } })
      .where(eq(migrationRun.id, migrationRunId))
      .returning({ id: migrationRun.id });
    if (!updatedRun) {
      throw new Error(`migration_run ${migrationRunId} not found while finalizing --execute`);
    }

    await tx.insert(auditLog).values({
      actorBdId,
      action: "migration_execute",
      metadata: { migrationRunId, backupPath, report: plan.report },
    });
  });
}
