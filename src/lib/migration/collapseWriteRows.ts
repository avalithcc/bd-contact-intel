/**
 * Pure builder that turns a collapse plan into insert-ready rows, so
 * `finalizeExecute` can write them in batches. Person ids are generated here
 * (not by the database) so connection, id-map and duplicate-candidate rows
 * can reference them without a round trip per person — the row-by-row
 * version ran for 7+ minutes inside one production transaction.
 */
import type {
  duplicateCandidate,
  person,
  personBdConnection,
  personIdMap,
} from "@/db/schema";
import type { CollapsePlan } from "./collapsePlanner";

// Postgres caps one statement at 65,535 bind parameters. The widest row here
// is `person` (18 columns → 18,000 per batch); recheck if it grows past ~65.
export const WRITE_BATCH_SIZE = 1000;

export interface CollapseWriteRows {
  persons: (typeof person.$inferInsert)[];
  connections: (typeof personBdConnection.$inferInsert)[];
  idMap: (typeof personIdMap.$inferInsert)[];
  duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("chunk size must be a positive integer");
  }
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export function buildCollapseWriteRows(
  plan: CollapsePlan,
  migrationRunId: string,
  newId: () => string,
): CollapseWriteRows {
  const idByPlanId = new Map<string, string>();
  const rows: CollapseWriteRows = { persons: [], connections: [], idMap: [], duplicateCandidates: [] };

  for (const p of plan.persons) {
    const id = newId();
    idByPlanId.set(p.planId, id);
    rows.persons.push({
      id,
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
    });
    for (const c of p.connections) {
      rows.connections.push({
        personId: id,
        bdId: c.bdId,
        connectedOn: c.connectedOn,
        legacyContactId: c.legacyContactId,
      });
    }
    for (const m of p.legacyMappings) {
      rows.idMap.push({
        legacyTable: "contact",
        legacyId: m.legacyContactId,
        personId: id,
        method: m.method,
        migrationRunId,
      });
    }
  }

  for (const skip of plan.ownCompanySkipped) {
    rows.idMap.push({
      legacyTable: "contact",
      legacyId: skip.legacyContactId,
      personId: null,
      method: "skipped_own_company",
      migrationRunId,
    });
  }

  for (const pair of plan.reviewPairs) {
    const a = idByPlanId.get(pair.planIdA);
    const b = idByPlanId.get(pair.planIdB);
    if (!a || !b) continue;
    const [personAId, personBId] = a < b ? [a, b] : [b, a];
    rows.duplicateCandidates.push({ personAId, personBId, reason: pair.reason, matchKey: pair.matchKey });
  }

  return rows;
}
