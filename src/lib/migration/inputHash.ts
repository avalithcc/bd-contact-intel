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

function canonicalRowString(row: CollapseContactRow): string {
  const keys = (Object.keys(row) as (keyof CollapseContactRow)[]).sort();
  return keys.map((key) => `${key}=${JSON.stringify(row[key])}`).join(FIELD_SEPARATOR);
}

export function computeCollapseInputHash(rows: CollapseContactRow[]): string {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(canonicalRowString(row));
    hash.update(ROW_SEPARATOR);
  }
  return hash.digest("hex");
}
