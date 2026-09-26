/**
 * DB-backed wiring for the `hubspot_import` phase (design D6; task 4.1).
 * Deliberately NOT unit-tested directly — it imports `@/db`, which throws at
 * import time without `DATABASE_URL` (same rationale as
 * src/lib/migration/catchUpQueries.ts's header). All branching logic worth
 * testing lives in the pure modules this wires: hubspot/planner,
 * hubspot/companies, hubspot/refill, hubspot/statusEvidence, hubspot/report,
 * identity/resolve, migration/executionGuard, migration/inputHash.
 *
 * Snapshot scope mirrors design D13 ("never load all persons"): existing
 * persons are prefetched only by the keys this run's rows actually carry
 * (`prefetchIdentityIndex`, reused as-is from the live resolver), never a
 * full `person` table scan.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, auditLog, bd, company, migrationRun, person, personIdMap, personPropertyHistory } from "@/db/schema";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import type { HubSpotRefillExistingPerson } from "@/lib/hubspot/refill";
import { statusBackfillIdempotencyKey, type StatusEvidenceStatus } from "@/lib/hubspot/statusEvidence";
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";
import { applyIdentityWrites, prefetchIdentityIndex, withIdentityLock } from "@/lib/identity/resolveDb";
import type { EmailStatus } from "@/lib/identity/matcher";
import type { IdentityIngestRow } from "@/lib/identity/resolve";
import { mapHubSpotContactToIdentityRow } from "@/lib/hubspot/identity";
import { resolveContactCompanyKey, type CompanyResolutionResult } from "@/lib/hubspot/companies";
import { recomputePersonStatuses } from "@/lib/status/recompute";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import type { FinalizeHubSpotExecuteInput } from "@/lib/migration/hubspotRun";
import type { MigrationRunKind } from "@/lib/migration/executionGuard";
import type { HubSpotRunReport } from "@/lib/hubspot/report";

/** `person_id_map` rows for THIS run's contacts (never a full-table scan),
 * keyed back to the raw HubSpot record id. */
export async function readExistingHubspotPersonIds(
  contacts: readonly HubSpotContactRow[],
): Promise<Map<string, string>> {
  const idsByLegacyId = new Map(contacts.map((c) => [hubspotLegacyId(c.hubspotContactId), c.hubspotContactId]));
  if (idsByLegacyId.size === 0) return new Map();

  const rows = await db
    .select({ legacyId: personIdMap.legacyId, personId: personIdMap.personId })
    .from(personIdMap)
    .where(
      and(eq(personIdMap.legacyTable, "hubspot_contact"), inArray(personIdMap.legacyId, [...idsByLegacyId.keys()])),
    );

  const result = new Map<string, string>();
  for (const r of rows) {
    if (!r.personId) continue; // skipped_own_company rows have a null personId
    const hubspotContactId = idsByLegacyId.get(r.legacyId);
    if (hubspotContactId) result.set(hubspotContactId, r.personId);
  }
  return result;
}

function toRefillExistingPerson(r: typeof person.$inferSelect): HubSpotRefillExistingPerson {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    company: r.company,
    companyKey: r.companyKey,
    jobTitle: r.jobTitle,
    industry: r.industry,
    city: r.city,
    country: r.country,
    ownerBdId: r.ownerBdId,
    email: r.email,
    emailNormalized: r.emailNormalized,
    emailStatus: r.emailStatus as EmailStatus,
    emailConfidence: r.emailConfidence,
    emailSource: r.emailSource,
  };
}

/** The already-mapped persons a re-import may refill (only the ids from
 * `readExistingHubspotPersonIds`, never a full-table scan). */
export async function readExistingPersonsForRefill(
  personIds: readonly string[],
): Promise<Map<string, HubSpotRefillExistingPerson>> {
  if (!personIds.length) return new Map();
  const rows = await db.select().from(person).where(inArray(person.id, [...personIds]));
  return new Map(rows.map((r) => [r.id, toRefillExistingPerson(r)]));
}

/** Active BDs for owner matching (hubspot-import spec "Owner mapping"). */
export async function readBds(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: bd.id, name: bd.name }).from(bd);
}

/** `hubspotCompanyId`s that already have a note activity (design D3: "skip
 * if one with the same hubspotCompanyId already exists"). */
export async function readExistingNoteHubspotCompanyIds(): Promise<Set<string>> {
  const rows = await db
    .select({ metadata: activity.metadata })
    .from(activity)
    .where(and(eq(activity.type, "note"), sql`${activity.metadata} ->> 'source' = 'hubspot_import'`));
  return new Set(
    rows
      .map((r) => (r.metadata as { hubspotCompanyId?: string } | null)?.hubspotCompanyId)
      .filter((id): id is string => !!id),
  );
}

/** `(hubspotContactId, status)` idempotency keys already written (task 3.7)
 * — a later export must not duplicate an existing status_backfill. */
export async function readExistingHubspotActivityKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ metadata: activity.metadata })
    .from(activity)
    .where(and(eq(activity.type, "status_backfill"), sql`${activity.metadata} ->> 'source' = 'hubspot_import'`));
  return new Set(
    rows
      .map((r) => {
        const m = r.metadata as { hubspotContactId?: string; status?: StatusEvidenceStatus } | null;
        return m?.hubspotContactId && m.status ? statusBackfillIdempotencyKey(m.hubspotContactId, m.status) : null;
      })
      .filter((k): k is string => !!k),
  );
}

/**
 * Only the existing persons that could match THIS run's rows (design D13),
 * mirroring catchUpQueries.ts#readExistingPersonsForCatchUp. `contacts` must
 * already have their companyKey resolved (Phase 2's companyResolution) so
 * the company-key prefetch query is scoped correctly.
 */
export async function readExistingPersonsForHubSpotImport(
  contacts: readonly HubSpotContactRow[],
  companyResolution: CompanyResolutionResult,
): Promise<ReturnType<typeof prefetchIdentityIndex>> {
  const rows: IdentityIngestRow[] = contacts.map((contact) => {
    const resolved = resolveContactCompanyKey(contact.associatedCompanyIdPrimary, companyResolution.byHubspotCompanyId);
    return mapHubSpotContactToIdentityRow({ contact, companyKey: resolved.companyKey, ownerBdId: null, migrationRunId: null });
  });
  return db.transaction((tx) => prefetchIdentityIndex(tx, rows));
}

/** Persists a fresh `dry_run` migration_run row for the hubspot_import phase. */
export async function saveHubSpotDryRunReport(input: {
  inputHash: string;
  report: HubSpotRunReport;
}): Promise<string> {
  const [row] = await db
    .insert(migrationRun)
    .values({ kind: "hubspot_import", mode: "dry_run", inputHash: input.inputHash, report: input.report })
    .returning({ id: migrationRun.id });
  return row.id;
}

export interface HubSpotMigrationRunForGate {
  id: string;
  kind: MigrationRunKind;
  approvedAt: Date | null;
  executedAt: Date | null;
  inputHash: string;
  approvedByBdId: string | null;
  reviewCount?: number;
  reviewThresholdConfirmed?: boolean;
}

/** Same shape as queries.ts#getMigrationRunForGate, extended with the
 * review-threshold fields executionGuard's hubspot_import check needs
 * (derived from the persisted report — see design D7/executionGuard.ts). */
export async function getHubSpotMigrationRunForGate(runId: string): Promise<HubSpotMigrationRunForGate | null> {
  const row = await db.query.migrationRun.findFirst({ where: eq(migrationRun.id, runId) });
  if (!row) return null;
  const report = row.report as { outcomes?: { review?: number }; reviewThresholdConfirmed?: boolean } | null;
  return {
    id: row.id,
    kind: row.kind as MigrationRunKind,
    approvedAt: row.approvedAt,
    executedAt: row.executedAt,
    inputHash: row.inputHash,
    approvedByBdId: row.approvedByBdId,
    reviewCount: report?.outcomes?.review,
    reviewThresholdConfirmed: report?.reviewThresholdConfirmed ?? false,
  };
}

/**
 * One transaction: claims the approved run, plans companies (create/domain
 * fill/notes), applies the identity write plan (persons/id-maps/duplicate
 * candidates — same `applyIdentityWrites` the live cutover uses, under the
 * same `withIdentityLock` caller contract as design D14), refills
 * already-imported persons, writes status-evidence and company-note
 * activities (skipping any whose idempotency key already exists),
 * recomputes touched person statuses, marks the run executed, and writes
 * one `audit_log(migration_execute)` entry — all batched (design D6:
 * `WRITE_BATCH_SIZE`), never row-by-row.
 */
export async function finalizeHubSpotExecute(input: FinalizeHubSpotExecuteInput): Promise<void> {
  const { plan, migrationRunId, actorBdId, backupPath } = input;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(migrationRun)
      .set({ mode: "execute", executedAt: new Date() })
      .where(
        and(eq(migrationRun.id, migrationRunId), isNull(migrationRun.executedAt), isNotNull(migrationRun.approvedAt)),
      )
      .returning({ id: migrationRun.id });
    if (!claimed) {
      throw new Error(`migration_run ${migrationRunId} is not an approved, unexecuted run; refusing to execute`);
    }

    // Companies: create, then domain-fill existing ones — before identity
    // writes, so newly created companyKeys are already committed for the
    // person rows that reference them.
    for (const batch of chunk(plan.companyResolution.companiesToCreate, WRITE_BATCH_SIZE)) {
      if (batch.length) {
        await tx
          .insert(company)
          .values(batch.map((c) => ({ companyKey: c.companyKey, displayName: c.displayName, domain: c.domain })))
          .onConflictDoNothing({ target: company.companyKey });
      }
    }
    for (const fill of plan.companyResolution.domainFills) {
      await tx.update(company).set({ domain: fill.domain }).where(eq(company.companyKey, fill.companyKey));
    }
    for (const batch of chunk(plan.companyResolution.notesToCreate, WRITE_BATCH_SIZE)) {
      if (batch.length) {
        await tx.insert(activity).values(
          batch.map((n) => ({
            companyKey: n.companyKey,
            actorBdId: null,
            type: "note",
            metadata: { body: n.body, source: "hubspot_import", hubspotCompanyId: n.hubspotCompanyId },
          })),
        );
      }
    }

    const touchedPersonIds = new Set<string>();

    if (plan.identityPlan) {
      await withIdentityLock(tx, () => applyIdentityWrites(tx, plan.identityPlan!));
      for (const u of plan.identityPlan.existingUpdates) touchedPersonIds.add(u.personId);
    }

    // Refill: fills only currently-empty fields on already_imported persons
    // (design D4 "Re-import (R7/Q3)") — each filled field also writes a
    // person_property_history(source:'import') row.
    for (const batch of chunk(plan.refillPlans, WRITE_BATCH_SIZE)) {
      for (const r of batch) {
        if (!r.plan.changed || !r.plan.personUpdate) continue;
        await tx.update(person).set(r.plan.personUpdate).where(eq(person.id, r.personId));
        if (r.plan.historyRows.length) {
          await tx.insert(personPropertyHistory).values(r.plan.historyRows);
        }
        touchedPersonIds.add(r.personId);
      }
    }

    // Status-evidence + idempotency: skip any activity whose
    // (hubspotContactId, status) key already exists (task 3.7).
    const existingKeys = await readExistingHubspotActivityKeys();
    const activitiesToInsert = plan.statusEvidence
      .flatMap((s) =>
        s.plan.activities
          .filter((a) => !existingKeys.has(a.idempotencyKey))
          .map((a) => ({ personId: s.personRef, actorBdId: null, type: "status_backfill", metadata: a.metadata })),
      );
    for (const batch of chunk(activitiesToInsert, WRITE_BATCH_SIZE)) {
      if (batch.length) await tx.insert(activity).values(batch);
    }
    for (const s of plan.statusEvidence) touchedPersonIds.add(s.personRef);

    if (touchedPersonIds.size) await recomputePersonStatuses(tx, [...touchedPersonIds]);

    await tx.update(migrationRun).set({ report: { ...plan.report, backupPath } }).where(eq(migrationRun.id, migrationRunId));

    await tx.insert(auditLog).values({
      actorBdId,
      action: "migration_execute",
      metadata: { migrationRunId, backupPath, report: plan.report },
    });
  });
}

// Re-exported so scripts/unify-contacts.ts imports every hubspot_import
// query from one module, mirroring collapse/fold/catch-up's single-import-
// site convention.
export { readExistingCompanies } from "./companyQueries";
