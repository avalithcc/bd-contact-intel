/**
 * Pure assembly of the /admin/duplicates detail from the batched rows that
 * `getDuplicateCandidateDetail` reads in one wave (persons, connections,
 * owners). Kept free of `@/db` so it is unit-testable; the queries live in
 * duplicateReviewQueries.ts.
 */
import type { bd, duplicateCandidate, person, personBdConnection } from "@/db/schema";
import { toMergeConnection, toMergeFields } from "@/lib/identity/mergeDb";
import { chooseDefaultSurvivor, previewMergeOutcome } from "@/lib/identity/duplicateReviewView";
import type { DuplicateCandidateDetail, DuplicateCandidateSidePerson } from "@/lib/identity/duplicateReviewQueries";

export function personDisplayName(row: { firstName: string | null; lastName: string | null }): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "(sin nombre)";
}

/** One `person_bd_connection` row LEFT JOINed to its bd; `bdName` is null when the bd row is missing. */
export interface ConnectionWithBdName {
  connection: typeof personBdConnection.$inferSelect;
  bdName: string | null;
}

export interface DuplicateDetailRows {
  candidate: typeof duplicateCandidate.$inferSelect;
  persons: readonly (typeof person.$inferSelect)[];
  connections: readonly ConnectionWithBdName[];
  owners: readonly Pick<typeof bd.$inferSelect, "id" | "name">[];
}

/** Returns null when either person row is missing, never throws (the page renders "ya resuelto"). */
export function assembleDuplicateDetail(rows: DuplicateDetailRows): DuplicateCandidateDetail | null {
  const { candidate } = rows;
  const personARow = rows.persons.find((p) => p.id === candidate.personAId);
  const personBRow = rows.persons.find((p) => p.id === candidate.personBId);
  if (!personARow || !personBRow) return null;

  const ownerNameById = new Map(rows.owners.map((o) => [o.id, o.name]));
  const forPerson = (personId: string) => rows.connections.filter((c) => c.connection.personId === personId);
  const sideOf = (row: typeof person.$inferSelect): DuplicateCandidateSidePerson => ({
    id: row.id,
    name: personDisplayName(row),
    jobTitle: row.jobTitle,
    email: row.email,
    emailStatus: row.emailStatus,
    profileKey: row.profileKey,
    city: row.city,
    region: row.region,
    country: row.country,
    // `?? null`, not `|| null`: the old `owner[0]?.name ?? null` kept an empty bd name, and `||` would turn it into null.
    ownerName: row.ownerBdId ? ownerNameById.get(row.ownerBdId) ?? null : null,
    status: row.status,
    createdAt: row.createdAt,
    // Displayed list = bd-joined rows only (the old inner join); the survivor
    // and preview logic below keeps every row, including one whose bd is gone.
    // `person_bd_connection.bd_id` is NOT NULL with ON DELETE CASCADE, so a bd-less row cannot exist today:
    // this filter is defensive fidelity to the old inner join, not a live case.
    connections: forPerson(row.id)
      .filter((c) => c.bdName !== null)
      .map((c) => ({ connectedOn: c.connection.connectedOn, bdName: c.bdName as string })),
  });

  const connectionsA = forPerson(personARow.id).map((c) => c.connection);
  const connectionsB = forPerson(personBRow.id).map((c) => c.connection);

  const recommendedSurvivor = chooseDefaultSurvivor(
    { id: personARow.id, profileKey: personARow.profileKey, createdAt: personARow.createdAt },
    connectionsA,
    { id: personBRow.id, profileKey: personBRow.profileKey, createdAt: personBRow.createdAt },
    connectionsB,
  );
  const survivorIsA = recommendedSurvivor === "a";
  const preview = previewMergeOutcome({
    survivor: toMergeFields(survivorIsA ? personARow : personBRow),
    merged: toMergeFields(survivorIsA ? personBRow : personARow),
    survivorConnections: (survivorIsA ? connectionsA : connectionsB).map(toMergeConnection),
    mergedConnections: (survivorIsA ? connectionsB : connectionsA).map(toMergeConnection),
  });

  return {
    id: candidate.id,
    reason: candidate.reason,
    matchKey: candidate.matchKey,
    personA: sideOf(personARow),
    personB: sideOf(personBRow),
    recommendedSurvivor,
    preview,
  };
}
