import { asc, desc, sql } from "drizzle-orm";
import { activity, duplicateCandidate } from "@/db/schema";

/**
 * True when ANY activity row belongs to either person of the pair. This is
 * the only kind of duplicate that costs work today: one BD's calls land on
 * one record and another's notes on the other, so the history splits.
 * Measured 2026-10-03 against production: 48 of 244 open pairs, 47 of them
 * with activity on one side only (the other side an empty shell).
 *
 * A correlated EXISTS, not a join: `activity` has many rows per person, so a
 * join would multiply pairs and need a de-dup. EXISTS yields one boolean per
 * pair, short-circuits on the first hit and is served by `activity_person_idx`.
 *
 * Built from schema columns only (no `@/db` import) so the rendered SQL is
 * unit-testable without DATABASE_URL.
 */
export function duplicateQueueHasActivity() {
  return sql<boolean>`exists (select 1 from ${activity} where ${activity.personId} in (${duplicateCandidate.personAId}, ${duplicateCandidate.personBId}))`;
}

/**
 * Pairs with activity first (Postgres sorts false < true, hence `desc`), then
 * newest first, then `id` so the order is TOTAL. The tiebreak is not
 * optional: production's 244 open pairs carry only 2 distinct `created_at`
 * values, so without it Postgres may return each group in any order and a
 * different one between requests, so paging the queue repeats some pairs and
 * skips others. Third occurrence of this exact defect on 2026-10-03 (launch-
 * readiness finding F4, then companyListOrderBy in
 * src/lib/companies/lastActivitySignal.ts, now this queue).
 */
export function duplicateQueueOrderBy() {
  return [desc(duplicateQueueHasActivity()), desc(duplicateCandidate.createdAt), asc(duplicateCandidate.id)];
}
