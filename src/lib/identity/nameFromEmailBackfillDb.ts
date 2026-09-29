/**
 * Thin DB layer for scripts/backfill-person-names-from-email.ts. All real
 * logic lives in nameFromEmailBackfill.ts (pure, unit-tested); this file only
 * touches the database — importing `db` throws without DATABASE_URL, same
 * convention as src/lib/identity/resolveDb.ts/mergeDb.ts.
 */
import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";
import type { NameFromEmailCandidate } from "@/lib/identity/nameFromEmailBackfill";

// 346 non-merged, both-empty-name persons existed at the time this backfill
// was designed (contact-identity owner ask). Capped well above that so a
// future run (after new nameless contacts appear) still can't turn into an
// unbounded read — see PERFORMANCE.md "LIMIT even when it is small today".
export const CANDIDATE_READ_CAP = 5000;

/**
 * Every non-merged person whose first_name AND last_name are BOTH empty
 * (null or blank) and who has an email to derive from — one indexed query,
 * capped, never a per-row read. Ordered by id for a deterministic dry-run
 * report.
 */
export async function readNameFromEmailBackfillCandidates(): Promise<NameFromEmailCandidate[]> {
  const rows = await db
    .select({ id: person.id, email: person.email, companyKey: person.companyKey })
    .from(person)
    .where(
      and(
        isNull(person.mergedIntoId),
        sql`(${person.firstName} is null or btrim(${person.firstName}) = '')`,
        sql`(${person.lastName} is null or btrim(${person.lastName}) = '')`,
        isNotNull(person.email),
      ),
    )
    .orderBy(person.id)
    .limit(CANDIDATE_READ_CAP);

  return rows.map((r) => ({ personId: r.id, email: r.email!, companyKey: r.companyKey }));
}

export interface ExistingPersonForCollisionCheck {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
}

/**
 * Every non-merged person whose companyKey is one of the ones appearing in
 * this run's fills — scoped by the `person_company_key_idx` index, NEVER the
 * whole `person` table (26,600+ rows). Feeds
 * nameFromEmailBackfill.ts#findNameCompanyCollisions. Empty input returns
 * empty output without a round trip.
 */
export async function readCollisionCandidates(
  companyKeys: readonly string[],
): Promise<ExistingPersonForCollisionCheck[]> {
  if (companyKeys.length === 0) return [];
  const rows = await db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, companyKey: person.companyKey })
    .from(person)
    .where(and(isNull(person.mergedIntoId), inArray(person.companyKey, [...companyKeys])))
    .limit(CANDIDATE_READ_CAP);
  return rows;
}
