/**
 * Pure builder that turns a fold-leads plan (src/lib/migration/foldPlanner.ts)
 * into insert/update-ready rows, mirroring collapseWriteRows.ts's rationale:
 * generate ids up front so id-map and duplicate-candidate rows can reference
 * them without a round trip per row, and never write one statement per lead.
 */
import type { duplicateCandidate, person, personIdMap } from "@/db/schema";
import type { FoldPlan } from "./foldPlanner";

export interface FoldPersonUpdate {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industry: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: string;
  emailConfidence: number | null;
  emailSource: string | null;
}

export interface FoldWriteRows {
  persons: (typeof person.$inferInsert)[];
  idMap: (typeof personIdMap.$inferInsert)[];
  duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[];
  personUpdates: FoldPersonUpdate[];
}

/**
 * `newId()` is only called for plan ids (`np...` — new/review leads); leads
 * that auto-merged reference an EXISTING person id already present in the
 * plan, so no id is generated for them.
 */
export function buildFoldWriteRows(
  plan: FoldPlan,
  migrationRunId: string,
  newId: () => string,
): FoldWriteRows {
  const idByPlanId = new Map<string, string>();
  for (const p of plan.newPersons) idByPlanId.set(p.planId, newId());

  const resolveRef = (ref: string) => idByPlanId.get(ref) ?? ref;

  const persons: (typeof person.$inferInsert)[] = plan.newPersons.map((p) => ({
    id: idByPlanId.get(p.planId)!,
    firstName: p.merged.firstName,
    lastName: p.merged.lastName,
    companyKey: p.merged.companyKey,
    jobTitle: p.merged.jobTitle,
    industry: p.merged.industry,
    email: p.merged.email,
    emailNormalized: p.merged.emailNormalized,
    emailStatus: p.merged.emailStatus,
    emailConfidence: p.merged.emailConfidence,
    emailSource: p.merged.emailSource,
    ownerBdId: p.ownerBdId,
    sourceKey: p.sourceKey,
    migrationRunId,
  }));

  const idMap: (typeof personIdMap.$inferInsert)[] = plan.mappings.map((m) => ({
    legacyTable: "lead" as const,
    legacyId: m.legacyLeadId,
    personId: m.personRef ? resolveRef(m.personRef) : null,
    method: m.method,
    migrationRunId,
  }));

  const personUpdates: FoldPersonUpdate[] = plan.matchedUpdates.map((u) => ({
    id: u.personId,
    ...u.merged,
  }));

  const duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[] = [];
  for (const pair of plan.reviewPairs) {
    const a = resolveRef(pair.refA);
    const b = resolveRef(pair.refB);
    const [personAId, personBId] = a < b ? [a, b] : [b, a];
    duplicateCandidates.push({ personAId, personBId, reason: pair.reason, matchKey: pair.matchKey });
  }

  return { persons, idMap, duplicateCandidates, personUpdates };
}
