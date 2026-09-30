/**
 * Thin DB layer for the Digital Finance Forum 2026 attendee import
 * (scripts/import-dff-2026.ts). Deliberately NOT unit-tested directly — it
 * imports `@/db`, which throws at import time without `DATABASE_URL` (same
 * rationale as src/lib/hubspot/importQueries.ts's header). All branching
 * logic worth testing lives in the pure modules this wires:
 * buildAttendeeRecords.ts, planImport.ts.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, auditLog, bd, company, companyAlias, person, personPropertyHistory } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import type { AttendeeRecord } from "./buildAttendeeRecords";
import {
  buildImportPlan,
  DFF_2026_ATTENDANCE_ACTIVITY_TYPE,
  DFF_2026_EVENT_NAME,
  DFF_2026_SOURCE_KEY,
  type DffAuditMetadata,
  type DffAuditRow,
  type DffImportPlan,
  type ExistingPersonForImport,
  type ImportContext,
  type ImportScope,
} from "./planImport";

const MARIEL_EMAIL = "mariel.meza@avalith.net";
export const DFF_2026_AUDIT_ACTION = "dff_2026_import";
export const DFF_2026_AUDIT_REVERT_ACTION = "dff_2026_import_revert";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Fails loudly rather than ever hardcoding a uuid (task brief). */
async function resolveMarielBdId(tx: DbTransaction): Promise<string> {
  const [row] = await tx.select({ id: bd.id }).from(bd).where(eq(bd.email, MARIEL_EMAIL)).limit(1);
  if (!row) throw new Error(`No bd row found for email ${MARIEL_EMAIL} — refusing to import without a real owner id.`);
  return row.id;
}

/** Only the existing data THIS run's rows could reference (never a
 * full-table scan) — mirrors src/lib/hubspot/importQueries.ts's "design D13"
 * prefetch convention. */
async function buildImportContext(tx: DbTransaction, records: readonly AttendeeRecord[]): Promise<ImportContext> {
  const marielBdId = await resolveMarielBdId(tx);
  const allBds = await tx.select({ id: bd.id, name: bd.name }).from(bd);
  const bdNamesById = new Map(allBds.map((b) => [b.id, b.name]));

  const emails = [...new Set(records.map((r) => r.emailNormalized))];
  const existingPersonsRows = emails.length
    ? await tx
        .select({
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          jobTitle: person.jobTitle,
          mobilePhone: person.mobilePhone,
          company: person.company,
          companyKey: person.companyKey,
          ownerBdId: person.ownerBdId,
          email: person.email,
          emailNormalized: person.emailNormalized,
          emailStatus: person.emailStatus,
          emailConfidence: person.emailConfidence,
          emailSource: person.emailSource,
        })
        .from(person)
        .where(and(inArray(person.emailNormalized, emails), isNull(person.mergedIntoId)))
    : [];
  const existingPersonsByEmail = new Map<string, ExistingPersonForImport>(
    existingPersonsRows.map((r) => [r.emailNormalized as string, r as ExistingPersonForImport]),
  );

  const rawCompanyKeys = [
    ...new Set(records.map((r) => (r.companyRaw ? normalizeCompanyKey(r.companyRaw) : null)).filter((k): k is string => !!k)),
  ];
  const aliasRows = rawCompanyKeys.length
    ? await tx.select({ aliasKey: companyAlias.aliasKey, companyKey: companyAlias.companyKey }).from(companyAlias).where(inArray(companyAlias.aliasKey, rawCompanyKeys))
    : [];
  const companyAliasByKey = new Map(aliasRows.map((r) => [r.aliasKey, r.companyKey]));

  const canonicalKeys = [...new Set(rawCompanyKeys.map((k) => companyAliasByKey.get(k) ?? k))];
  const companyRows = canonicalKeys.length
    ? await tx.select({ companyKey: company.companyKey, displayName: company.displayName }).from(company).where(inArray(company.companyKey, canonicalKeys))
    : [];
  const existingCompaniesByKey = new Map(companyRows.map((r) => [r.companyKey, r]));

  const existingPersonIds = existingPersonsRows.map((r) => r.id);
  const attendanceRows = existingPersonIds.length
    ? await tx
        .select({ personId: activity.personId })
        .from(activity)
        .where(
          and(
            eq(activity.type, DFF_2026_ATTENDANCE_ACTIVITY_TYPE),
            sql`${activity.metadata} ->> 'source' = ${DFF_2026_SOURCE_KEY}`,
            inArray(activity.personId, existingPersonIds),
          ),
        )
    : [];
  const existingAttendancePersonIds = new Set(attendanceRows.map((r) => r.personId).filter((id): id is string => !!id));

  return { marielBdId, bdNamesById, existingPersonsByEmail, companyAliasByKey, existingCompaniesByKey, existingAttendancePersonIds };
}

/** Read-only — the dry-run path. Wrapped in a transaction for the same
 * reason src/lib/hubspot/importQueries.ts#readExistingPersonsForHubSpotImport
 * is: it's the only way to hand `prefetchIdentityIndex`-style helpers a
 * `DbTransaction`, and reading inside a transaction is a no-op commit. */
export async function dryRunDffImport(records: readonly AttendeeRecord[], scope: ImportScope): Promise<DffImportPlan> {
  return db.transaction(async (tx) => {
    const ctx = await buildImportContext(tx, records);
    return buildImportPlan(records, scope, ctx);
  });
}

export interface ExecuteDffImportResult {
  plan: DffImportPlan;
  auditLogId: string;
}

const TEXT_COLUMN_BY_PROPERTY: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  jobTitle: "job_title",
  roleGroup: "role_group",
  mobilePhone: "mobile_phone",
  company: "company",
  companyKey: "company_key",
};

/**
 * Builds the context and plan FRESH inside the transaction (never reusing a
 * plan object from a separate dry-run invocation), then writes it all in
 * ONE transaction, batched (rule: "never row by row"): companies, then new
 * persons, then one batched `UPDATE ... FROM (VALUES ...)` for existing
 * persons, then person_property_history, then attendance activities, then a
 * checked postcondition, then one audit_log row.
 */
export async function executeDffImport(
  records: readonly AttendeeRecord[],
  scope: ImportScope,
  actorBdId: string,
): Promise<ExecuteDffImportResult> {
  return db.transaction(async (tx) => {
    const ctx = await buildImportContext(tx, records);
    const plan = buildImportPlan(records, scope, ctx);

    for (const batch of chunk(plan.companiesToCreate, WRITE_BATCH_SIZE)) {
      if (batch.length) {
        await tx
          .insert(company)
          .values(batch.map((c) => ({ companyKey: c.companyKey, displayName: c.displayName, createdByBdId: actorBdId, updatedByBdId: actorBdId })))
          .onConflictDoNothing({ target: company.companyKey });
      }
    }

    for (const batch of chunk(plan.creates, WRITE_BATCH_SIZE)) {
      if (batch.length) await tx.insert(person).values(batch.map((p) => ({ ...p, updatedByBdId: actorBdId })));
    }

    const dirtyUpdates = plan.updates.filter((u) => Object.keys(u.personUpdate).length > 0);
    for (const batch of chunk(dirtyUpdates, WRITE_BATCH_SIZE)) {
      if (!batch.length) continue;
      const values = batch.map((u) => {
        const p = u.personUpdate;
        return sql`(${u.personId}::uuid, ${p.firstName ?? null}::text, ${p.lastName ?? null}::text, ${p.jobTitle ?? null}::text, ${p.roleGroup ?? null}::text, ${p.mobilePhone ?? null}::text, ${p.company ?? null}::text, ${p.companyKey ?? null}::text, ${p.ownerBdId ?? null}::uuid)`;
      });
      await tx.execute(sql`
        UPDATE person AS p
        SET first_name = COALESCE(v.first_name, p.first_name),
            last_name = COALESCE(v.last_name, p.last_name),
            job_title = COALESCE(v.job_title, p.job_title),
            role_group = COALESCE(v.role_group, p.role_group),
            mobile_phone = COALESCE(v.mobile_phone, p.mobile_phone),
            company = COALESCE(v.company, p.company),
            company_key = COALESCE(v.company_key, p.company_key),
            owner_bd_id = COALESCE(v.owner_bd_id, p.owner_bd_id),
            updated_by_bd_id = ${actorBdId}::uuid,
            updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, first_name, last_name, job_title, role_group, mobile_phone, company, company_key, owner_bd_id)
        WHERE p.id = v.id
      `);
    }

    const historyRows = plan.updates.flatMap((u) => u.historyRows);
    for (const batch of chunk(historyRows, WRITE_BATCH_SIZE)) {
      if (batch.length) await tx.insert(personPropertyHistory).values(batch);
    }

    // The source file carries no per-attendee attendance date — `importedAt`
    // is labeled as exactly that (when THIS script ran), never a stand-in
    // for when the event actually happened, per owner instruction.
    const importedAt = new Date().toISOString();
    const attendanceRowsToInsert = plan.attendance.map((a) => ({
      personId: a.personId,
      actorBdId,
      type: DFF_2026_ATTENDANCE_ACTIVITY_TYPE,
      metadata: { source: DFF_2026_SOURCE_KEY, eventName: DFF_2026_EVENT_NAME, attended: true, importedAt },
    }));
    const attendanceActivityIds: string[] = [];
    for (const batch of chunk(attendanceRowsToInsert, WRITE_BATCH_SIZE)) {
      if (batch.length) {
        const inserted = await tx.insert(activity).values(batch).returning({ id: activity.id });
        attendanceActivityIds.push(...inserted.map((r) => r.id));
      }
    }

    // Owner reconfirmation (2026-09-30), checked postcondition, not assumed.
    const [{ count: badSourceKeyCount }] = (await tx.execute(sql`
      select count(*)::int as count from person
      where source_key = ${DFF_2026_SOURCE_KEY} and owner_bd_id is distinct from ${ctx.marielBdId}::uuid
    `)) as unknown as { count: number }[];
    if (badSourceKeyCount > 0) {
      throw new Error(`dff-2026 import postcondition failed: ${badSourceKeyCount} person row(s) with source_key='${DFF_2026_SOURCE_KEY}' are not owned by Mariel.`);
    }
    const touchedIds = [...plan.creates.map((c) => c.id!), ...plan.updates.map((u) => u.personId)];
    if (touchedIds.length) {
      const mismatched = await tx
        .select({ id: person.id })
        .from(person)
        .where(and(inArray(person.id, touchedIds), sql`${person.ownerBdId} is distinct from ${ctx.marielBdId}::uuid`));
      if (mismatched.length > 0) {
        throw new Error(`dff-2026 import postcondition failed: ${mismatched.length} touched person row(s) are not owned by Mariel: ${mismatched.map((m) => m.id).join(", ")}`);
      }
    }

    const metadata: DffAuditMetadata = {
      sourceKey: DFF_2026_SOURCE_KEY,
      scope,
      createdPersonIds: plan.creates.map((c) => c.id!),
      updatedHistoryRows: historyRows,
      companiesCreated: plan.companiesToCreate.map((c) => c.companyKey),
      attendanceActivityIds,
    };
    const [auditRow] = await tx.insert(auditLog).values({ actorBdId, action: DFF_2026_AUDIT_ACTION, metadata }).returning({ id: auditLog.id });

    return { plan, auditLogId: auditRow!.id };
  });
}

export async function readDffAuditRows(): Promise<DffAuditRow[]> {
  const rows = await db.select({ id: auditLog.id, at: auditLog.at, actorBdId: auditLog.actorBdId, metadata: auditLog.metadata }).from(auditLog).where(eq(auditLog.action, DFF_2026_AUDIT_ACTION));
  return rows.map((r) => ({ id: r.id, at: r.at, actorBdId: r.actorBdId!, metadata: r.metadata as DffAuditMetadata }));
}

export interface ExecuteDffRevertResult {
  revertedByProperty: Record<string, number>;
  skippedByProperty: Record<string, number>;
  deletedPersonIds: string[];
  deletedCompanyKeys: string[];
  deletedAttendanceActivityIds: string[];
}

/** Reverts exactly one audit row: deletes the activities/persons/companies
 * this run created, and restores every field it filled/reassigned on
 * pre-existing persons — re-checking, per batched field, that the current
 * value still equals what THIS run wrote before restoring it (a field a BD
 * has since edited again is left alone, not clobbered back). */
export async function executeDffRevert(auditRow: DffAuditRow, actorBdId: string): Promise<ExecuteDffRevertResult> {
  const m = auditRow.metadata;
  return db.transaction(async (tx) => {
    const deletedAttendanceActivityIds = [...m.attendanceActivityIds];
    for (const batch of chunk(m.attendanceActivityIds, WRITE_BATCH_SIZE)) {
      if (batch.length) await tx.delete(activity).where(inArray(activity.id, batch));
    }

    const byProperty = new Map<string, typeof m.updatedHistoryRows>();
    for (const h of m.updatedHistoryRows) {
      const list = byProperty.get(h.property) ?? [];
      list.push(h);
      byProperty.set(h.property, list);
    }

    const revertedByProperty: Record<string, number> = {};
    const skippedByProperty: Record<string, number> = {};

    for (const [property, rows] of byProperty) {
      if (property === "ownerBdId") continue; // handled separately below (uuid column)
      const column = TEXT_COLUMN_BY_PROPERTY[property];
      if (!column) continue; // defensive: this script never writes any other property
      for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
        const values = batch.map((r) => sql`(${r.personId}::uuid, ${r.oldValue}::text, ${r.newValue}::text)`);
        const result = (await tx.execute(sql`
          UPDATE person AS p SET ${sql.raw(column)} = v.old_value, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
          FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, old_value, new_value)
          WHERE p.id = v.id AND p.${sql.raw(column)} IS NOT DISTINCT FROM v.new_value
          RETURNING p.id
        `)) as unknown as { id: string }[];
        revertedByProperty[property] = (revertedByProperty[property] ?? 0) + result.length;
        skippedByProperty[property] = (skippedByProperty[property] ?? 0) + (batch.length - result.length);
      }
    }

    const ownerRows = byProperty.get("ownerBdId") ?? [];
    for (const batch of chunk(ownerRows, WRITE_BATCH_SIZE)) {
      const values = batch.map((r) => sql`(${r.personId}::uuid, ${r.oldValue}::uuid, ${r.newValue}::uuid)`);
      const result = (await tx.execute(sql`
        UPDATE person AS p SET owner_bd_id = v.old_value, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, old_value, new_value)
        WHERE p.id = v.id AND p.owner_bd_id IS NOT DISTINCT FROM v.new_value
        RETURNING p.id
      `)) as unknown as { id: string }[];
      revertedByProperty.ownerBdId = (revertedByProperty.ownerBdId ?? 0) + result.length;
      skippedByProperty.ownerBdId = (skippedByProperty.ownerBdId ?? 0) + (batch.length - result.length);
    }

    let deletedPersonIds: string[] = [];
    if (m.createdPersonIds.length) {
      const deleted = await tx
        .delete(person)
        .where(and(inArray(person.id, m.createdPersonIds), eq(person.sourceKey, DFF_2026_SOURCE_KEY)))
        .returning({ id: person.id });
      deletedPersonIds = deleted.map((r) => r.id);
    }

    let deletedCompanyKeys: string[] = [];
    if (m.companiesCreated.length) {
      const stillReferenced = await tx.select({ companyKey: person.companyKey }).from(person).where(and(inArray(person.companyKey, m.companiesCreated), isNull(person.mergedIntoId)));
      const stillReferencedKeys = new Set(stillReferenced.map((r) => r.companyKey));
      const toDelete = m.companiesCreated.filter((k) => !stillReferencedKeys.has(k));
      if (toDelete.length) {
        await tx.delete(company).where(inArray(company.companyKey, toDelete));
        deletedCompanyKeys = toDelete;
      }
    }

    await tx.insert(auditLog).values({
      actorBdId,
      action: DFF_2026_AUDIT_REVERT_ACTION,
      metadata: { revertedAuditLogId: auditRow.id, deletedPersonIds, deletedCompanyKeys, deletedAttendanceActivityIds, revertedByProperty, skippedByProperty },
    });

    return { revertedByProperty, skippedByProperty, deletedPersonIds, deletedCompanyKeys, deletedAttendanceActivityIds };
  });
}
