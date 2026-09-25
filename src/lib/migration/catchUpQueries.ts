/**
 * DB-backed wiring for the catch-up phase (task 4B.8; design.md "Catch-up
 * (owner D4b)"; contact-migration spec "Incremental catch-up run").
 * Deliberately NOT unit-tested directly — it imports `@/db`, which throws at
 * import time without `DATABASE_URL` (see src/lib/migration/queries.ts's
 * same-rationale header). All branching logic worth testing lives in the
 * pure modules this file wires: catchUpPlanner, catchUpRun, executionGuard,
 * inputHash.
 *
 * Readers only ever touch UNMAPPED or drifted rows, never the whole
 * `contact`/`lead` universe (design D13's "never load all persons"
 * rationale, extended to catch-up's inputs): the anti-join is pushed into
 * SQL via `NOT EXISTS (person_id_map ...)`, and existing-person prefetch
 * reuses `prefetchIdentityIndex`'s 3 indexed queries (profile_key/verified-
 * email/company_key), scoped to the keys this run's rows actually carry —
 * never a full `person` table scan.
 *
 * Contact drift (design.md: "contacts, which lack updated_at, via the
 * existing diff core") is NOT implemented here: `contact` has no updated_at
 * column and no existing diff core to reuse (the design's reference to
 * `planCollapseMergeRepair` describes an aspiration, not a function that
 * exists in this codebase). Only the anti-join (never-mapped) contacts and
 * leads, plus lead drift by `updated_at`, are wired — see this batch's
 * apply-progress note for the explicit scope call.
 */
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, auditLog, contact, lead, migrationRun, signal, task } from "@/db/schema";
import type { CatchUpContactRow, CatchUpLeadRow } from "./catchUpPlanner";
import type { FinalizeCatchUpExecuteInput } from "./catchUpRun";
import { contactRowsToIdentityRows, leadRowsToIdentityRows } from "@/lib/identity/ingestWrite";
import { applyIdentityWrites, prefetchIdentityIndex, withIdentityLock } from "@/lib/identity/resolveDb";
import type { ExistingPersonCandidate } from "@/lib/identity/resolve";
import type { EmailStatus } from "@/lib/identity/matcher";

const READ_BATCH_SIZE = 1000;

/** `contact` rows with no `person_id_map` entry yet (never-mapped, keyset-paged). */
export async function readUnmappedContacts(): Promise<CatchUpContactRow[]> {
  const rows: CatchUpContactRow[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(contact)
      .where(
        and(
          sql`NOT EXISTS (SELECT 1 FROM person_id_map m WHERE m.legacy_table = 'contact' AND m.legacy_id = ${contact.id})`,
          lastId === null ? undefined : sql`${contact.id} > ${lastId}`,
        ),
      )
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
        position: r.position,
        industry: r.industry,
        connectedOn: r.connectedOn,
        email: r.email,
        emailStatus: r.emailStatus as EmailStatus,
        emailConfidence: r.emailConfidence,
        emailSource: r.emailSource,
      });
    }
    lastId = page[page.length - 1].id;
  }
  return rows;
}

function toCatchUpLeadRow(r: typeof lead.$inferSelect): CatchUpLeadRow {
  return {
    id: r.id,
    ownerBdId: r.ownerBdId,
    firstName: r.firstName,
    lastName: r.lastName,
    companyDisplay: r.companyDisplay,
    companyRaw: r.companyRaw,
    companyKey: r.companyKey,
    jobTitle: r.jobTitle,
    industryGroup: r.industryGroup,
    industryRaw: r.industryRaw,
    email: r.email,
    emailStatus: r.emailStatus as EmailStatus,
    emailConfidence: r.emailConfidence,
    emailSource: r.emailSource,
  };
}

/** `lead` rows with no `person_id_map` entry yet (never-mapped, keyset-paged). */
export async function readUnmappedLeads(): Promise<CatchUpLeadRow[]> {
  const rows: CatchUpLeadRow[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(lead)
      .where(
        and(
          sql`NOT EXISTS (SELECT 1 FROM person_id_map m WHERE m.legacy_table = 'lead' AND m.legacy_id = ${lead.id})`,
          lastId === null ? undefined : sql`${lead.id} > ${lastId}`,
        ),
      )
      .orderBy(lead.id)
      .limit(READ_BATCH_SIZE);
    if (!page.length) break;

    for (const r of page) rows.push(toCatchUpLeadRow(r));
    lastId = page[page.length - 1].id;
  }
  return rows;
}

/**
 * Already-mapped `lead` rows edited since `since` (design: "drift in mapped
 * rows (leads by updated_at)"). Planned identically to an anti-join row: a
 * drifted row that still matches its own person resolves to an ordinary
 * "auto" update (catchUpPlanner.ts header).
 */
export async function readDriftedLeads(since: Date): Promise<CatchUpLeadRow[]> {
  const rows: CatchUpLeadRow[] = [];
  let lastId: string | null = null;

  for (;;) {
    const page = await db
      .select()
      .from(lead)
      .where(
        and(
          isNotNull(lead.updatedAt),
          gt(lead.updatedAt, since),
          sql`EXISTS (SELECT 1 FROM person_id_map m WHERE m.legacy_table = 'lead' AND m.legacy_id = ${lead.id})`,
          lastId === null ? undefined : sql`${lead.id} > ${lastId}`,
        ),
      )
      .orderBy(lead.id)
      .limit(READ_BATCH_SIZE);
    if (!page.length) break;

    for (const r of page) rows.push(toCatchUpLeadRow(r));
    lastId = page[page.length - 1].id;
  }
  return rows;
}

/**
 * Only the existing persons that could match THIS run's rows (design D13) —
 * reuses `prefetchIdentityIndex`'s 3 indexed queries (profile_key/verified-
 * email/company_key) against a throwaway `db.transaction` used only for the
 * read, never the whole `person` table.
 */
export async function readExistingPersonsForCatchUp(
  contacts: readonly CatchUpContactRow[],
  leads: readonly CatchUpLeadRow[],
): Promise<ExistingPersonCandidate[]> {
  const identityRows = [...contactRowsToIdentityRows(contacts), ...leadRowsToIdentityRows(leads)];
  return db.transaction((tx) => prefetchIdentityIndex(tx, identityRows));
}

/** Persists a fresh `dry_run` migration_run row for the catch-up phase. */
export async function saveCatchUpDryRunReport(input: {
  inputHash: string;
  report: Record<string, unknown>;
}): Promise<string> {
  const [row] = await db
    .insert(migrationRun)
    .values({ kind: "catch_up", mode: "dry_run", inputHash: input.inputHash, report: input.report })
    .returning({ id: migrationRun.id });
  return row.id;
}

/**
 * One transaction: claims the approved run, applies the identity write plan
 * (persons/connections/id-maps — same `applyIdentityWrites` the live
 * cutover uses, under the same `withIdentityLock` caller contract as
 * design D14), re-points every `activity`/`task`/`signal` row with a null
 * `person_id` via a set-based `UPDATE ... FROM person_id_map`, marks the run
 * executed, and writes one `audit_log(migration_execute)` entry.
 */
export async function finalizeCatchUpExecute(input: FinalizeCatchUpExecuteInput): Promise<void> {
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

    await withIdentityLock(tx, () => applyIdentityWrites(tx, plan.plan));

    // Set-based re-point: any activity/task/signal row still carrying a null
    // person_id, for EITHER legacy subject (contact or lead), gets one
    // through the map this run (or an earlier one) just wrote.
    for (const table of [activity, task, signal]) {
      await tx.execute(sql`
        UPDATE ${table} AS r
        SET person_id = m.person_id
        FROM person_id_map m
        WHERE r.person_id IS NULL
          AND (
            (m.legacy_table = 'contact' AND m.legacy_id = r.contact_id)
            OR (m.legacy_table = 'lead' AND m.legacy_id = r.lead_id)
          )
      `);
    }

    await tx
      .update(migrationRun)
      .set({ report: { ...plan.plan.report, leadsSkippedNoOwner: plan.leadsSkippedNoOwner, backupPath } })
      .where(eq(migrationRun.id, migrationRunId));

    await tx.insert(auditLog).values({
      actorBdId,
      action: "migration_execute",
      metadata: { migrationRunId, backupPath, report: plan.plan.report },
    });
  });
}

// Re-exported so scripts/unify-contacts.ts imports every catch-up query from
// one module, mirroring collapse/fold's single-import-site convention.
export { getMigrationRunForGate } from "./queries";
