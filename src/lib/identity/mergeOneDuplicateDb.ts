/**
 * Thin DB layer for scripts/merge-one-duplicate.ts; every decision lives in
 * mergeOneDuplicate.ts (unit-tested). Three reads (candidate, both people with
 * their activity counts, their connections), the dry run in a READ ONLY
 * transaction. Execute re-plans and then calls mergeContacts, the exact function
 * /admin/duplicates uses: its own transaction locks both rows, repoints
 * everything, marks the candidate merged, and writes the merge_event snapshot
 * plus the one audit_log row ('merge'). There is no parallel merge here.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { duplicateCandidate, personBdConnection } from "@/db/schema";
import { mergeContacts } from "@/lib/identity/mergeDb";
import { isUuid } from "@/lib/uuid";
import { planMergeOne, type MergeOnePlan, type MergeOneSide } from "./mergeOneDuplicate";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<DbTransaction, "select" | "execute">;

export interface MergeOneReport {
  plan: MergeOnePlan;
  /** Activity rows per person id: informational, the survivor choice does not depend on it. */
  activities: Record<string, number>;
}

async function loadAndPlan(reader: Reader, candidateId: string, survivorArg: string | null): Promise<MergeOneReport> {
  if (!isUuid(candidateId)) throw new Error("--candidate must be a duplicate_candidate uuid.");
  if (survivorArg !== null && !isUuid(survivorArg)) throw new Error("--survivor must be a person uuid.");
  const [candidate] = await reader.select().from(duplicateCandidate).where(eq(duplicateCandidate.id, candidateId)).limit(1);
  if (!candidate) throw new Error("No duplicate_candidate with that id.");

  const ids = [candidate.personAId, candidate.personBId];
  const people = (await reader.execute(sql`
    select p.id::text as id, p.profile_key, p.created_at, p.merged_into_id::text as merged_into_id,
      (select count(*)::int from activity a where a.person_id = p.id) as activity_count
    from person p where p.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as { id: string; profile_key: string | null; created_at: Date | string; merged_into_id: string | null; activity_count: number | string }[];
  const connections = await reader
    .select({ personId: personBdConnection.personId, connectedOn: personBdConnection.connectedOn, messageCount: personBdConnection.messageCount })
    .from(personBdConnection)
    .where(inArray(personBdConnection.personId, ids));

  const toSide = (id: string): MergeOneSide => {
    const p = people.find((r) => r.id === id);
    if (!p) throw new Error("A person of the candidate no longer exists.");
    return {
      id,
      profileKey: p.profile_key,
      createdAt: new Date(p.created_at),
      mergedIntoId: p.merged_into_id,
      connections: connections.filter((c) => c.personId === id).map((c) => ({ connectedOn: c.connectedOn, messageCount: c.messageCount })),
    };
  };
  const plan = planMergeOne({
    candidate: { id: candidate.id, status: candidate.status, reason: candidate.reason, personAId: candidate.personAId, personBId: candidate.personBId },
    a: toSide(candidate.personAId),
    b: toSide(candidate.personBId),
    survivorArg,
  });
  return { plan, activities: Object.fromEntries(people.map((p) => [p.id, Number(p.activity_count)])) };
}

export async function dryRunMergeOne(candidateId: string, survivorArg: string | null): Promise<MergeOneReport> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return loadAndPlan(tx, candidateId, survivorArg);
  });
}

export async function executeMergeOne(candidateId: string, survivorArg: string | null, actorBdId: string): Promise<MergeOneReport & { mergeEventId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  const report = await loadAndPlan(db, candidateId, survivorArg);
  if (report.plan.kind === "refuse") return { ...report, mergeEventId: null };
  const { mergeEventId } = await mergeContacts(db, report.plan.survivorId, report.plan.mergedId, report.plan.reason, actorBdId);
  return { ...report, mergeEventId };
}
