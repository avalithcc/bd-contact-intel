/**
 * Bulk DB read for scripts/merge-duplicates.ts (the owner-run bulk merge of
 * the /admin/duplicates queue). Unlike getDuplicateCandidateDetail
 * (duplicateReviewQueries.ts), which does several round trips PER pair for
 * the single-pair review UI, this fetches every open pair's person and
 * connection rows in a fixed, small number of round trips regardless of
 * queue size (PERFORMANCE.md: round trips are the budget, not how the work
 * is arranged) — 353 pairs cost the same 3 queries as 3 pairs would.
 *
 * Not unit-tested directly — importing `@/db` throws without DATABASE_URL,
 * same convention as mergeDb.ts/duplicateReviewQueries.ts; the pure planner
 * it feeds (planDuplicateTierRun) is covered by
 * tests/unit/duplicateTiering.test.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { duplicateCandidate, person, personBdConnection } from "@/db/schema";
import type { DuplicatePairPlanInput, DuplicatePairPlanPerson } from "@/lib/identity/duplicateTiering";

// Defensive cap (PERFORMANCE.md / query rule 7: bounded, never an
// unbounded read) — the queue was 353 open pairs when this script was
// written; an order of magnitude of headroom before this needs paging.
const MAX_OPEN_PAIRS = 5000;

/**
 * Reads every open duplicate_candidate pair plus both persons' full fields
 * and every person_bd_connection row needed by the tier planner, in three
 * round trips total:
 *   1. open duplicate_candidate rows (bounded by MAX_OPEN_PAIRS)
 *   2. every distinct person referenced by those pairs (single IN query)
 *   3. every person_bd_connection row for those same persons (single IN query)
 */
export async function loadOpenDuplicatePairsForTiering(): Promise<DuplicatePairPlanInput[]> {
  const candidates = await db
    .select({
      id: duplicateCandidate.id,
      reason: duplicateCandidate.reason,
      personAId: duplicateCandidate.personAId,
      personBId: duplicateCandidate.personBId,
    })
    .from(duplicateCandidate)
    .where(eq(duplicateCandidate.status, "open"))
    // ORDER BY is required alongside LIMIT: without it, if the queue ever
    // reaches MAX_OPEN_PAIRS, Postgres is free to return an arbitrary subset
    // that can differ run to run (silent, non-deterministic truncation).
    // Ordering by id makes which pairs get cut (if it ever comes to that)
    // deterministic and stable across runs.
    .orderBy(duplicateCandidate.id)
    .limit(MAX_OPEN_PAIRS);

  if (candidates.length === 0) return [];

  const personIds = [...new Set(candidates.flatMap((c) => [c.personAId, c.personBId]))];

  const [personRows, connectionRows] = await Promise.all([
    db.select().from(person).where(inArray(person.id, personIds)),
    db
      .select({
        personId: personBdConnection.personId,
        connectedOn: personBdConnection.connectedOn,
        messageCount: personBdConnection.messageCount,
      })
      .from(personBdConnection)
      .where(inArray(personBdConnection.personId, personIds)),
  ]);

  const personById = new Map(personRows.map((r) => [r.id, r]));
  const connectionsByPersonId = new Map<string, { connectedOn: string | null; messageCount: number }[]>();
  for (const row of connectionRows) {
    const list = connectionsByPersonId.get(row.personId) ?? [];
    list.push({ connectedOn: row.connectedOn, messageCount: row.messageCount });
    connectionsByPersonId.set(row.personId, list);
  }

  function toPlanPerson(personId: string): DuplicatePairPlanPerson | null {
    const row = personById.get(personId);
    if (!row) return null;
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      emailStatus: row.emailStatus as DuplicatePairPlanPerson["emailStatus"],
      profileKey: row.profileKey,
      jobTitle: row.jobTitle,
      ownerBdId: row.ownerBdId,
      createdAt: row.createdAt,
      connections: connectionsByPersonId.get(personId) ?? [],
    };
  }

  const pairs: DuplicatePairPlanInput[] = [];
  for (const c of candidates) {
    const personA = toPlanPerson(c.personAId);
    const personB = toPlanPerson(c.personBId);
    // A pair whose person was hidden by a merge since this read started (or
    // any other data anomaly) is skipped rather than crashing the whole run
    // — it will simply be re-evaluated (or no longer be open) next run.
    if (!personA || !personB) continue;
    pairs.push({ candidateId: c.id, reason: c.reason, personA, personB });
  }
  return pairs;
}
