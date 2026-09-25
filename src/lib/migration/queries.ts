/**
 * DB-backed wiring for the collapse migration (design.md "Migration plan").
 * Deliberately NOT unit-tested directly — it imports `@/db`, which throws
 * at import time without `DATABASE_URL` (see src/lib/auth/requireAdmin.ts
 * for the same split rationale). All branching logic worth testing lives
 * in the pure modules this file wires: collapsePlanner, collapseRun,
 * executionGuard, inputHash.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  auditLog,
  bd,
  contact,
  duplicateCandidate,
  lead,
  migrationRun,
  person,
  personBdConnection,
  personIdMap,
  signal,
  task,
} from "@/db/schema";
import { assertApprovable, MigrationApproveBlockedError } from "./approveGuard";
import type { CollapseContactRow, CollapsePlan } from "./collapsePlanner";
import type { ApprovedMigrationRun, FinalizeExecuteInput } from "./collapseRun";
import { buildCollapseWriteRows, chunk, WRITE_BATCH_SIZE } from "./collapseWriteRows";
import type { MigrationRunKind } from "./executionGuard";
import type { FoldExistingPerson, FoldLeadRow, FoldPlan } from "./foldPlanner";
import type { FinalizeFoldExecuteInput } from "./foldRun";
import { buildFoldWriteRows } from "./foldWriteRows";
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

/**
 * Fetches the run `--execute --run=<id>` was pointed at, for
 * assertExecutionAllowed — including `kind`, so the gate can refuse
 * `--phase=fold_leads --execute --run=<a collapse run's id>` (and vice
 * versa) instead of relying on an incidental input-hash mismatch.
 */
export async function getMigrationRunForGate(runId: string): Promise<ApprovedMigrationRun | null> {
  const row = await db.query.migrationRun.findFirst({ where: eq(migrationRun.id, runId) });
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind as "collapse" | "fold_leads",
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
    .orderBy(desc(migrationRun.createdAt), desc(migrationRun.id))
    .limit(1);
  return runs[0] ?? null;
}

/**
 * `/admin/migration`'s "Approve dry run" action (admin-access-audit spec).
 * `expectedKind` comes from the section/form that submitted `runId` — a
 * fresh-review WARNING found this approved ANY runId unconditionally, so
 * `assertApprovable` now also refuses a kind mismatch, an already
 * approved/executed run, or a run that isn't the latest dry run of its
 * kind (a newer dry run has superseded it).
 */
export async function approveMigrationRun(
  runId: string,
  approvedByBdId: string,
  expectedKind: MigrationRunKind,
) {
  const [candidate, latest] = await Promise.all([
    getMigrationRunForGate(runId),
    getLatestMigrationRun(expectedKind),
  ]);
  assertApprovable(candidate, expectedKind, latest?.id ?? null);

  return db.transaction(async (tx) => {
    // Claim atomically (same pattern as finalizeExecute): if a concurrent
    // approval landed after the checks above, zero rows match and the second
    // admin gets `already_approved` instead of a duplicate audit row.
    const [updated] = await tx
      .update(migrationRun)
      .set({ approvedByBdId, approvedAt: new Date() })
      .where(
        and(
          eq(migrationRun.id, runId),
          isNull(migrationRun.approvedAt),
          isNull(migrationRun.executedAt),
        ),
      )
      .returning();
    if (!updated) throw new MigrationApproveBlockedError("already_approved");
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
    // Claim the run first. The conditional UPDATE row-locks it until commit,
    // so a second concurrent --execute blocks here and then matches zero rows
    // instead of racing past the pre-transaction guard.
    const [claimed] = await tx
      .update(migrationRun)
      .set({ mode: "execute", executedAt: new Date() })
      .where(
        and(
          eq(migrationRun.id, migrationRunId),
          isNull(migrationRun.executedAt),
          isNotNull(migrationRun.approvedAt),
        ),
      )
      .returning({ id: migrationRun.id });
    if (!claimed) {
      throw new Error(
        `migration_run ${migrationRunId} is not an approved, unexecuted run; refusing to execute`,
      );
    }

    // Batched writes: ~60 round trips instead of one per row. Persons first,
    // since connections, id-map rows and candidates reference their ids.
    const rows = buildCollapseWriteRows(plan, migrationRunId, randomUUID);
    for (const batch of chunk(rows.persons, WRITE_BATCH_SIZE)) {
      await tx.insert(person).values(batch);
    }
    for (const batch of chunk(rows.connections, WRITE_BATCH_SIZE)) {
      await tx.insert(personBdConnection).values(batch);
    }
    for (const batch of chunk(rows.idMap, WRITE_BATCH_SIZE)) {
      await tx.insert(personIdMap).values(batch);
    }
    for (const batch of chunk(rows.duplicateCandidates, WRITE_BATCH_SIZE)) {
      await tx.insert(duplicateCandidate).values(batch).onConflictDoNothing();
    }

    // Link back to the approved dry run rather than orphaning a new row —
    // the backup path is folded into the existing jsonb `report` column
    // (re-derived report content is identical to the dry run's, since
    // assertExecutionAllowed already proved the input_hash matches) rather
    // than adding a dedicated schema column for this one field.
    await tx
      .update(migrationRun)
      .set({ report: { ...plan.report, backupPath } })
      .where(eq(migrationRun.id, migrationRunId));

    await tx.insert(auditLog).values({
      actorBdId,
      action: "migration_execute",
      metadata: { migrationRunId, backupPath, report: plan.report },
    });
  });
}

// ---------------------------------------------------------------------------
// Fold-leads phase (design.md "Migration plan" step 4; task 4.3).
// ---------------------------------------------------------------------------

/** Every `lead` row, narrowed to the fields foldPlanner.ts's matcher and merge need. */
export async function readAllLeadRows(): Promise<FoldLeadRow[]> {
  const rows: FoldLeadRow[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(lead)
      .where(lastId === null ? undefined : sql`${lead.id} > ${lastId}`)
      .orderBy(lead.id)
      .limit(READ_BATCH_SIZE);
    if (!page.length) break;

    for (const r of page) {
      rows.push({
        id: r.id,
        ownerBdId: r.ownerBdId,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.companyDisplay ?? r.companyRaw,
        companyKey: r.companyKey,
        jobTitle: r.jobTitle,
        industry: r.industryGroup ?? r.industryRaw,
        email: r.email,
        emailStatus: r.emailStatus as EmailStatus,
        emailConfidence: r.emailConfidence,
        emailSource: r.emailSource,
        sourceKey: r.sourceKey,
        status: r.status as FoldLeadRow["status"],
        updatedByBdId: r.updatedByBdId,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      });
    }
    lastId = page[page.length - 1].id;
  }
  return rows;
}

/**
 * Every `type` already logged per `leadId` (task 4.2's "no supporting
 * activity" check) — grouped in one query rather than N lead-scoped ones.
 */
export async function readActivityTypesByLeadId(): Promise<Map<string, Set<string>>> {
  const rows = await db
    .selectDistinct({ leadId: activity.leadId, type: activity.type })
    .from(activity)
    .where(isNotNull(activity.leadId));

  const result = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.leadId) continue;
    const types = result.get(r.leadId) ?? new Set<string>();
    types.add(r.type);
    result.set(r.leadId, types);
  }
  return result;
}

/** Every non-merged `person` row, seeding the fold matcher's `IdentityIndex` (Phase 3 already executed). */
export async function readExistingPersonsForFold(): Promise<FoldExistingPerson[]> {
  const rows: FoldExistingPerson[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(person)
      .where(
        and(
          isNull(person.mergedIntoId),
          lastId === null ? undefined : sql`${person.id} > ${lastId}`,
        ),
      )
      .orderBy(person.id)
      .limit(READ_BATCH_SIZE);
    if (!page.length) break;

    for (const r of page) {
      rows.push({
        id: r.id,
        profileKey: r.profileKey,
        firstName: r.firstName,
        lastName: r.lastName,
        companyKey: r.companyKey,
        email: r.email,
        emailNormalized: r.emailNormalized,
        emailStatus: r.emailStatus as EmailStatus,
        emailConfidence: r.emailConfidence,
        emailSource: r.emailSource,
        jobTitle: r.jobTitle,
        industry: r.industry,
      });
    }
    lastId = page[page.length - 1].id;
  }
  return rows;
}

/** Persists a fresh `dry_run` migration_run row for the fold-leads phase. */
export async function saveFoldDryRunReport(input: {
  inputHash: string;
  report: FoldPlan["report"];
}): Promise<string> {
  const [row] = await db
    .insert(migrationRun)
    .values({ kind: "fold_leads", mode: "dry_run", inputHash: input.inputHash, report: input.report })
    .returning({ id: migrationRun.id });
  return row.id;
}

/**
 * One transaction: inserts new persons, updates matched-existing persons,
 * writes person_id_map/duplicate_candidate rows, re-points `activity`/
 * `task`/`signal` rows that reference a folded lead (`linkedin_scrape_job`
 * has no lead-scoped column, so it is never re-pointed here), marks the
 * approved run executed, and writes one audit_log(migration_execute) entry.
 */
export async function finalizeFoldExecute(input: FinalizeFoldExecuteInput): Promise<void> {
  const { plan, migrationRunId, actorBdId, backupPath } = input;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(migrationRun)
      .set({ mode: "execute", executedAt: new Date() })
      .where(
        and(
          eq(migrationRun.id, migrationRunId),
          isNull(migrationRun.executedAt),
          isNotNull(migrationRun.approvedAt),
        ),
      )
      .returning({ id: migrationRun.id });
    if (!claimed) {
      throw new Error(
        `migration_run ${migrationRunId} is not an approved, unexecuted run; refusing to execute`,
      );
    }

    const rows = buildFoldWriteRows(plan, migrationRunId, randomUUID);
    for (const batch of chunk(rows.persons, WRITE_BATCH_SIZE)) {
      await tx.insert(person).values(batch);
    }
    for (const batch of chunk(rows.personUpdates, WRITE_BATCH_SIZE)) {
      const values = batch.map(
        (u) =>
          sql`(${u.id}::uuid, ${u.firstName}::text, ${u.lastName}::text, ${u.companyKey}::text, ${u.jobTitle}::text, ${u.industry}::text, ${u.email}::text, ${u.emailNormalized}::text, ${u.emailStatus}::text, ${u.emailConfidence}::int, ${u.emailSource}::text)`,
      );
      await tx.execute(sql`
        UPDATE person AS p
        SET first_name = v.first_name, last_name = v.last_name, company_key = v.company_key,
            job_title = v.job_title, industry = v.industry, email = v.email,
            email_normalized = v.email_normalized, email_status = v.email_status,
            email_confidence = v.email_confidence, email_source = v.email_source,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)})
          AS v(id, first_name, last_name, company_key, job_title, industry, email,
               email_normalized, email_status, email_confidence, email_source)
        WHERE p.id = v.id
      `);
    }
    for (const batch of chunk(rows.idMap, WRITE_BATCH_SIZE)) {
      await tx.insert(personIdMap).values(batch);
    }
    for (const batch of chunk(rows.duplicateCandidates, WRITE_BATCH_SIZE)) {
      await tx.insert(duplicateCandidate).values(batch).onConflictDoNothing();
    }
    for (const batch of chunk(rows.activities, WRITE_BATCH_SIZE)) {
      await tx.insert(activity).values(batch);
    }

    // Set-based re-point: every activity/task/signal row still carrying a
    // legacy leadId with no person_id gets one through the map this run (or
    // an earlier one) just wrote — never one UPDATE per row.
    for (const table of [activity, task, signal]) {
      await tx.execute(sql`
        UPDATE ${table} AS r
        SET person_id = m.person_id
        FROM person_id_map m
        WHERE m.legacy_table = 'lead' AND m.legacy_id = r.lead_id AND r.person_id IS NULL
      `);
    }

    await tx
      .update(migrationRun)
      .set({ report: { ...plan.report, backupPath } })
      .where(eq(migrationRun.id, migrationRunId));

    await tx.insert(auditLog).values({
      actorBdId,
      action: "migration_execute",
      metadata: { migrationRunId, backupPath, report: plan.report },
    });
  });
}
