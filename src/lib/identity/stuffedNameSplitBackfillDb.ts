/**
 * Thin DB layer for scripts/backfill-split-stuffed-names.ts. All real logic
 * lives in stuffedNameSplitBackfill.ts (pure, unit-tested); this file only
 * touches the database — importing `db` throws without DATABASE_URL, same
 * convention as src/lib/identity/nameFromEmailBackfillDb.ts.
 */
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";
import type { StuffedNameSplitCandidate } from "@/lib/identity/stuffedNameSplitBackfill";

// The orchestrator's measured target is 227 first-name-only rows in
// production. Capped well above that so a future run (after new nameless
// contacts appear) still can't turn into an unbounded read — see
// PERFORMANCE.md "LIMIT even when it is small today".
export const STUFFED_NAME_SPLIT_CANDIDATE_READ_CAP = 5000;

/**
 * Every non-merged person whose first_name contains whitespace and whose
 * last_name is empty (null or blank) — one indexed query, capped, never a
 * per-row read. Ordered by id for a deterministic dry-run report. `email`
 * is read (nullable) purely as a tie-breaker input for ambiguous splits —
 * this backfill does not require an email to exist.
 */
export async function readStuffedNameSplitCandidates(): Promise<StuffedNameSplitCandidate[]> {
  const rows = await db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      company: person.company,
      companyKey: person.companyKey,
    })
    .from(person)
    .where(
      and(
        isNull(person.mergedIntoId),
        // NOTE: '\s' inside a JS template literal is not an escape sequence
        // — it "cooks" down to a literal "s", silently turning this into
        // "contains the letter s" instead of a whitespace check. Must be
        // '\\s' so Postgres actually receives the two characters \ and s.
        sql`${person.firstName} is not null and ${person.firstName} ~ '\\s'`,
        sql`(${person.lastName} is null or btrim(${person.lastName}) = '')`,
      ),
    )
    .orderBy(person.id)
    .limit(STUFFED_NAME_SPLIT_CANDIDATE_READ_CAP);

  return rows.map((r) => ({
    personId: r.id,
    firstName: r.firstName!,
    originalLastName: r.lastName,
    email: r.email,
    company: r.company,
    companyKey: r.companyKey,
  }));
}
