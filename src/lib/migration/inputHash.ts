/**
 * Deterministic fingerprint of the exact `contact` row set a dry run was
 * computed from (design.md "Migration plan": `--execute` "refuses if
 * `input_hash` changed or the run is not approved"). Sorted by id first so
 * the hash depends only on which rows exist and their content, not on
 * database read order. Pure — no DB access.
 *
 * Deliberately hashes EVERY own-enumerable field of each row via
 * `Object.keys` (sorted, so key order can't drift the hash either) instead
 * of a hand-picked field list. A hand-picked list silently goes stale the
 * moment `CollapseContactRow` gains a field the planner reads (this exact
 * bug happened once already — companyKey/companyCategory/roleGroup/
 * industry/emailConfidence/emailSource were added to the type but never
 * added here). Reflecting over the row's own keys means there is no second
 * list to keep in sync — see tests/unit/migrationInputHash.test.ts's
 * "no field is silently ignored" regression test.
 */
import { createHash } from "node:crypto";
import type { CollapseContactRow } from "./collapsePlanner";

const FIELD_SEPARATOR = "\u0001";
const ROW_SEPARATOR = "\u0002";
const SET_SEPARATOR = "\u0003";

function canonicalRowString<T extends Record<string, unknown>>(row: T): string {
  const keys = (Object.keys(row) as (keyof T)[]).sort();
  return keys.map((key) => `${String(key)}=${JSON.stringify(row[key])}`).join(FIELD_SEPARATOR);
}

/**
 * Reflective row-set hash shared by every migration phase: hashes EVERY
 * own-enumerable field of every row (sorted by id, keys sorted too) instead
 * of a hand-picked field list, so a row set that later gains a field the
 * planner reads can never silently drift out of this hash (see
 * tests/unit/migrationInputHash.test.ts's "no field is silently ignored"
 * regression test, which this generalization preserves for collapse).
 */
export function hashRowSet<T extends { id: string }>(rows: readonly T[]): string {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(canonicalRowString(row));
    hash.update(ROW_SEPARATOR);
  }
  return hash.digest("hex");
}

export function computeCollapseInputHash(rows: CollapseContactRow[]): string {
  return hashRowSet(rows);
}

/**
 * Fold-leads input hash: covers both row sets the planner depends on — the
 * `lead` rows being folded AND the `person`/`person_id_map` snapshot the
 * `IdentityIndex` is seeded from (design.md D12 rationale: the planner's
 * output depends on both). Combining two `hashRowSet` results (rather than
 * hashing one concatenated array) keeps each set's own row shape reflective,
 * without requiring a shared row type between leads and existing persons.
 */
export function computeFoldInputHash<
  L extends { id: string },
  P extends { id: string },
>(leads: readonly L[], existingPersons: readonly P[]): string {
  const hash = createHash("sha256");
  hash.update(hashRowSet(leads));
  hash.update(SET_SEPARATOR);
  hash.update(hashRowSet(existingPersons));
  return hash.digest("hex");
}
