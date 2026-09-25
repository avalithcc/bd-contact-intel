/**
 * DB-backed reads for the /admin/duplicates review queue (Phase 7 task 7.2;
 * duplicate-review spec). Not unit-tested directly — importing `@/db`
 * throws without `DATABASE_URL`, same convention as mergeDb.ts/resolveDb.ts;
 * the pure pieces it wires (chooseDefaultSurvivor/previewMergeOutcome) are
 * covered by tests/unit/duplicateReviewView.test.ts.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bd, duplicateCandidate, mergeEvent, person, personBdConnection } from "@/db/schema";
import { toMergeConnection, toMergeFields } from "@/lib/identity/mergeDb";
import { chooseDefaultSurvivor, previewMergeOutcome, type DuplicateReviewSide } from "@/lib/identity/duplicateReviewView";
import type { MergePlan } from "@/lib/identity/merge";

const PAGE_SIZE = 20;

function personDisplayName(row: { firstName: string | null; lastName: string | null }): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "(sin nombre)";
}

export interface DuplicateCandidateListItem {
  id: string;
  personAName: string;
  personBName: string;
  company: string | null;
  reason: string;
  createdAt: Date;
}

export interface DuplicateCandidateListPage {
  items: DuplicateCandidateListItem[];
  total: number;
  page: number;
  pageCount: number;
}

/** Open pairs, most recent first. `page` is 1-based. */
export async function listOpenDuplicateCandidates(page = 1): Promise<DuplicateCandidateListPage> {
  const rows = await db
    .select({
      id: duplicateCandidate.id,
      reason: duplicateCandidate.reason,
      createdAt: duplicateCandidate.createdAt,
      companyA: person.company,
      firstNameA: person.firstName,
      lastNameA: person.lastName,
    })
    .from(duplicateCandidate)
    .innerJoin(person, eq(person.id, duplicateCandidate.personAId))
    .where(eq(duplicateCandidate.status, "open"))
    .orderBy(desc(duplicateCandidate.createdAt));

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
  }));

  return { items, total, page, pageCount };
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

async function readSidePerson(personId: string): Promise<DuplicateCandidateSidePerson> {
  const [row] = await db.select().from(person).where(eq(person.id, personId));
  if (!row) throw new Error(`Duplicate candidate refused: person ${personId} not found`);

  const connectionRows = await db
    .select({
      connectedOn: personBdConnection.connectedOn,
      bdName: bd.name,
    })
    .from(personBdConnection)
    .innerJoin(bd, eq(bd.id, personBdConnection.bdId))
    .where(eq(personBdConnection.personId, personId));

  const owner = row.ownerBdId ? await db.select({ name: bd.name }).from(bd).where(eq(bd.id, row.ownerBdId)) : [];

  return {
    id: row.id,
    name: personDisplayName(row),
    jobTitle: row.jobTitle,
    email: row.email,
    emailStatus: row.emailStatus,
    profileKey: row.profileKey,
    city: row.city,
    region: row.region,
    country: row.country,
    ownerName: owner[0]?.name ?? null,
    status: row.status,
    createdAt: row.createdAt,
    connections: connectionRows,
  };
}

/** Returns null if the pair isn't open anymore (already resolved by someone else). */
export async function getDuplicateCandidateDetail(candidateId: string): Promise<DuplicateCandidateDetail | null> {
  const [candidate] = await db
    .select()
    .from(duplicateCandidate)
    .where(and(eq(duplicateCandidate.id, candidateId), eq(duplicateCandidate.status, "open")));
  if (!candidate) return null;

  const [personARow] = await db.select().from(person).where(eq(person.id, candidate.personAId));
  const [personBRow] = await db.select().from(person).where(eq(person.id, candidate.personBId));
  if (!personARow || !personBRow) return null;

  const [connectionsA, connectionsB, personA, personB] = await Promise.all([
    db.select().from(personBdConnection).where(eq(personBdConnection.personId, candidate.personAId)),
    db.select().from(personBdConnection).where(eq(personBdConnection.personId, candidate.personBId)),
    readSidePerson(candidate.personAId),
    readSidePerson(candidate.personBId),
  ]);

  const recommendedSurvivor = chooseDefaultSurvivor(
    { id: personARow.id, profileKey: personARow.profileKey, createdAt: personARow.createdAt },
    connectionsA,
    { id: personBRow.id, profileKey: personBRow.profileKey, createdAt: personBRow.createdAt },
    connectionsB,
  );

  const survivorRow = recommendedSurvivor === "a" ? personARow : personBRow;
  const mergedRow = recommendedSurvivor === "a" ? personBRow : personARow;
  const survivorConnections = recommendedSurvivor === "a" ? connectionsA : connectionsB;
  const mergedConnections = recommendedSurvivor === "a" ? connectionsB : connectionsA;

  const preview = previewMergeOutcome({
    survivor: toMergeFields(survivorRow),
    merged: toMergeFields(mergedRow),
    survivorConnections: survivorConnections.map(toMergeConnection),
    mergedConnections: mergedConnections.map(toMergeConnection),
  });

  return {
    id: candidate.id,
    reason: candidate.reason,
    matchKey: candidate.matchKey,
    personA,
    personB,
    recommendedSurvivor,
    preview,
  };
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
    .orderBy(desc(mergeEvent.createdAt))
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
