/**
 * DB-backed reads for the /admin/duplicates review queue (Phase 7 task 7.2;
 * duplicate-review spec). Not unit-tested directly — importing `@/db`
 * throws without `DATABASE_URL`, same convention as mergeDb.ts/resolveDb.ts;
 * the pure pieces it wires (chooseDefaultSurvivor/previewMergeOutcome) are
 * covered by tests/unit/duplicateReviewView.test.ts.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bd, duplicateCandidate, mergeEvent, person, personBdConnection } from "@/db/schema";
import { duplicateQueueHasActivity, duplicateQueueOrderBy } from "@/lib/identity/duplicateQueueOrder";
import { assembleDuplicateDetail, personDisplayName } from "@/lib/identity/duplicateDetailRows";
import type { DuplicateReviewSide } from "@/lib/identity/duplicateReviewView";
import type { MergePlan } from "@/lib/identity/merge";

const PAGE_SIZE = 20;

export interface DuplicateCandidateListItem {
  id: string;
  personAName: string;
  personBName: string;
  company: string | null;
  reason: string;
  createdAt: Date;
  // Either person already has logged activity: the history is splitting.
  hasActivity: boolean;
}

export interface DuplicateCandidateListPage {
  items: DuplicateCandidateListItem[];
  total: number;
  page: number;
  pageCount: number;
  // 0-based offset of `items[0]` within the full open-queue ordering, so the
  // page can render "Par N de {total}" without re-deriving pagination math.
  startIndex: number;
}

/**
 * Open pairs: those with activity on either side first, then most recent
 * first, `id` as the final tiebreak (see duplicateQueueOrder.ts). `page` is
 * 1-based. The activity EXISTS is evaluated inside this one query, before the
 * in-memory page slice, so it orders the whole queue rather than one page.
 */
export async function listOpenDuplicateCandidates(page = 1): Promise<DuplicateCandidateListPage> {
  const rows = await db
    .select({
      id: duplicateCandidate.id,
      reason: duplicateCandidate.reason,
      createdAt: duplicateCandidate.createdAt,
      hasActivity: duplicateQueueHasActivity(),
      companyA: person.company,
      firstNameA: person.firstName,
      lastNameA: person.lastName,
    })
    .from(duplicateCandidate)
    .innerJoin(person, eq(person.id, duplicateCandidate.personAId))
    .where(eq(duplicateCandidate.status, "open"))
    .orderBy(...duplicateQueueOrderBy());

  // personBId's name is fetched in a second pass to keep the join above
  // single-sided (drizzle would otherwise need two aliased joins on `person`).
  const bIds = rows.map((r) => r.id);
  const personBRows =
    bIds.length === 0
      ? []
      : await db
          .select({ candidateId: duplicateCandidate.id, firstName: person.firstName, lastName: person.lastName })
          .from(duplicateCandidate)
          .innerJoin(person, eq(person.id, duplicateCandidate.personBId))
          .where(eq(duplicateCandidate.status, "open"));
  const bNameByCandidate = new Map(personBRows.map((r) => [r.candidateId, personDisplayName(r)]));

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const items = rows.slice(start, start + PAGE_SIZE).map((r) => ({
    id: r.id,
    personAName: personDisplayName({ firstName: r.firstNameA, lastName: r.lastNameA }),
    personBName: bNameByCandidate.get(r.id) ?? "(sin nombre)",
    company: r.companyA,
    reason: r.reason,
    createdAt: r.createdAt,
    hasActivity: r.hasActivity === true,
  }));

  return { items, total, page, pageCount, startIndex: start };
}

export interface DuplicateCandidateSidePerson {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  emailStatus: string;
  profileKey: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ownerName: string | null;
  status: string;
  createdAt: Date;
  connections: { bdName: string; connectedOn: string | null }[];
}

export interface DuplicateCandidateDetail {
  id: string;
  reason: string;
  matchKey: string;
  personA: DuplicateCandidateSidePerson;
  personB: DuplicateCandidateSidePerson;
  recommendedSurvivor: DuplicateReviewSide;
  preview: MergePlan;
}

/**
 * Returns null if the pair isn't open anymore (already resolved by someone else)
 * or either person is gone.
 *
 * Two waves, four queries: the candidate, then persons / connections / owners
 * for BOTH sides at once. Round trips are the cost here, not the work, so each
 * table is read once with `inArray` instead of once per side.
 */
export async function getDuplicateCandidateDetail(candidateId: string): Promise<DuplicateCandidateDetail | null> {
  const [candidate] = await db
    .select()
    .from(duplicateCandidate)
    .where(and(eq(duplicateCandidate.id, candidateId), eq(duplicateCandidate.status, "open")));
  if (!candidate) return null;

  const personIds = [candidate.personAId, candidate.personBId];
  // Owner ids are only known from the person rows, so owners are read through
  // a subquery on the same ids instead of waiting for a third wave.
  const [persons, connections, owners] = await Promise.all([
    db.select().from(person).where(inArray(person.id, personIds)),
    // LEFT join: the survivor/preview logic needs every connection row, even
    // one whose bd is missing; assembleDuplicateDetail drops those from the
    // displayed list only.
    db
      .select({ connection: personBdConnection, bdName: bd.name })
      .from(personBdConnection)
      .leftJoin(bd, eq(bd.id, personBdConnection.bdId))
      .where(inArray(personBdConnection.personId, personIds)),
    db
      .select({ id: bd.id, name: bd.name })
      .from(bd)
      .where(inArray(bd.id, db.select({ id: person.ownerBdId }).from(person).where(inArray(person.id, personIds)))),
  ]);

  return assembleDuplicateDetail({ candidate, persons, connections, owners });
}

export interface MergeHistoryRow {
  mergeEventId: string;
  survivorName: string;
  reason: string;
  actorName: string | null;
  createdAt: Date;
  undoneAt: Date | null;
}

/** Most recent merges, undone or not, for the "historial de fusiones" table. */
export async function listRecentMergeEvents(limit = 20): Promise<MergeHistoryRow[]> {
  const rows = await db
    .select({
      mergeEventId: mergeEvent.id,
      reason: mergeEvent.reason,
      createdAt: mergeEvent.createdAt,
      undoneAt: mergeEvent.undoneAt,
      survivorFirstName: person.firstName,
      survivorLastName: person.lastName,
      actorName: bd.name,
    })
    .from(mergeEvent)
    .innerJoin(person, eq(person.id, mergeEvent.survivorId))
    .leftJoin(bd, eq(bd.id, mergeEvent.actorBdId))
    // `id` tiebreak: merges from one bulk run can share a created_at, and
    // without it the "last N" cut is not deterministic.
    .orderBy(desc(mergeEvent.createdAt), asc(mergeEvent.id))
    .limit(limit);

  return rows.map((r) => ({
    mergeEventId: r.mergeEventId,
    survivorName: personDisplayName({ firstName: r.survivorFirstName, lastName: r.survivorLastName }),
    reason: r.reason,
    actorName: r.actorName,
    createdAt: r.createdAt,
    undoneAt: r.undoneAt,
  }));
}
