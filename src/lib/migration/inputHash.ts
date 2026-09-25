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
 * Deterministic fingerprint of `activityTypesByLeadId` — a THIRD
 * `planFoldLeads` input (`planStatusBackfills`'s "no supporting activity"
 * check), separate from the two row sets below because it isn't a row set
 * at all (a `Map<leadId, Set<type>>`). Sorted by leadId, and each lead's
 * types sorted too, so Map insertion order and Set iteration order can't
 * drift the hash (fresh-review fix: a lead gaining/losing a supporting
 * activity type between dry run and execute must trip `stale_input_hash`,
 * not silently execute against a plan the owner never actually reviewed).
 */
function hashActivityTypesByLeadId(activityTypesByLeadId: ReadonlyMap<string, ReadonlySet<string>>): string {
  const entries = [...activityTypesByLeadId.entries()]
    .map(([leadId, types]) => `${leadId}=${[...types].sort().join(",")}`)
    .sort();
  return entries.join(ROW_SEPARATOR);
}

/**
 * Fold-leads input hash: covers every input `planFoldLeads` reads — the
 * `lead` rows being folded, the `person`/`person_id_map` snapshot the
 * `IdentityIndex` is seeded from (design.md D12 rationale: the planner's
 * output depends on both), AND `activityTypesByLeadId` (fresh-review fix —
 * previously unhashed, so a change in existing activity types between dry
 * run and execute was never detected as stale). Combining `hashRowSet`
 * results (rather than hashing one concatenated array) keeps each set's own
 * row shape reflective, without requiring a shared row type between leads
 * and existing persons.
 */
/**
 * Catch-up input hash (task 4B.7; design.md "Catch-up (owner D4b)"): covers
 * every input `planCatchUp` reads — the unmapped/drifted `contact` and
 * `lead` rows themselves AND the existing-person snapshot the identity index
 * is matched against (same D12 rationale as `computeFoldInputHash`: the
 * plan's output depends on both, so both must invalidate a stale dry run).
 */
export function computeCatchUpInputHash<
  C extends { id: string },
  L extends { id: string },
  P extends { id: string },
>(contacts: readonly C[], leads: readonly L[], existingPersons: readonly P[]): string {
  const hash = createHash("sha256");
  hash.update(hashRowSet(contacts));
  hash.update(SET_SEPARATOR);
  hash.update(hashRowSet(leads));
  hash.update(SET_SEPARATOR);
  hash.update(hashRowSet(existingPersons));
  return hash.digest("hex");
}

export function computeFoldInputHash<
  L extends { id: string },
  P extends { id: string },
>(
  leads: readonly L[],
  existingPersons: readonly P[],
  activityTypesByLeadId: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const hash = createHash("sha256");
  hash.update(hashRowSet(leads));
  hash.update(SET_SEPARATOR);
  hash.update(hashRowSet(existingPersons));
  hash.update(SET_SEPARATOR);
  hash.update(hashActivityTypesByLeadId(activityTypesByLeadId));
  return hash.digest("hex");
}
