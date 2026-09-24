/**
 * Deterministic fingerprint of the exact `contact` row set a dry run was
 * computed from (design.md "Migration plan": `--execute` "refuses if
 * `input_hash` changed or the run is not approved"). Sorted by id first so
 * the hash depends only on which rows exist and their content, not on
 * database read order. Pure — no DB access.
 */
import { createHash } from "node:crypto";
import type { CollapseContactRow } from "./collapsePlanner";

const FIELD_SEPARATOR = "\u0001";
const ROW_SEPARATOR = "\u0002";

export function computeCollapseInputHash(rows: CollapseContactRow[]): string {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(
      [
        row.id,
        row.bdId,
        row.profileKey,
        row.firstName ?? "",
        row.lastName ?? "",
        row.company ?? "",
        row.position ?? "",
        row.email ?? "",
        row.emailStatus,
        row.connectedOn ?? "",
      ].join(FIELD_SEPARATOR),
    );
    hash.update(ROW_SEPARATOR);
  }
  return hash.digest("hex");
}
