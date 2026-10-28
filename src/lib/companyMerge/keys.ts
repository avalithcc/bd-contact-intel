/**
 * Shared vocabulary of the company-merge tooling: which tables carry a
 * `company_key`, the one key builder for per-table reference counts, and the
 * squash used to PROPOSE (never to decide) duplicate candidates.
 */

/** Every table with a `company_key` column. A test fails when the schema and this list drift apart. */
export const COMPANY_KEY_TABLES = [
  "activity",
  "board_candidate",
  "company",
  "company_alias",
  "company_probe",
  "company_property_history",
  "contact",
  "job_posting",
  "lead",
  "person",
  "signal",
  "sync_run",
  "target_company",
  "task",
] as const;

/**
 * Tables the pre-merge dump of scripts/merge-companies.ts --execute must carry: every table the merge
 * repoints, patches or deletes from, plus the one other table it writes — the proposals it marks
 * 'applied'. The merge has no per-row undo, so this dump is the only way back.
 *
 * It is NOT the default BACKUP_TABLES of src/lib/migration/backup.ts: that set was written for the
 * HubSpot import and omits company_alias, company_probe and company_property_history, which a company
 * merge writes. Derived from COMPANY_KEY_TABLES so a new keyed table cannot fall out of the dump.
 *
 * `audit_log` is deliberately absent. The merge's own audit row is inserted AFTER the dump is taken, so
 * no dump can contain it; including the table would only copy unrelated history, and it is large.
 * `company_absorption_proposal` only exists from migration 0040, which is why the script requires the
 * COMPANY_KEY_TABLES subset to be present in the dump and not this whole list.
 */
export const COMPANY_MERGE_BACKUP_TABLES = [...COMPANY_KEY_TABLES, "company_absorption_proposal"] as const;

/** Key of the reference-count map: the producer (buildRefCounts) and every reader go through these two. */
export const refKey = (table: string, companyKey: string): string => `${table}|${companyKey}`;

/** Raw rows of the per-table count query: counts arrive as numbers or strings depending on the driver path. */
export function buildRefCounts(rows: readonly { t: string; k: string; n: number | string }[]): Map<string, number> {
  return new Map(rows.map((r) => [refKey(r.t, r.k), Number(r.n)]));
}

export const refCount = (counts: ReadonlyMap<string, number>, table: string, companyKey: string): number =>
  counts.get(refKey(table, companyKey)) ?? 0;

/**
 * Same squash as the SQL `regexp_replace(lower(company_key), '[^a-z0-9]', '', 'g')`, except that "nothing left" is
 * `null`, never `""`. A HEURISTIC: `&company` and `Company` squash alike and are different companies, so it may only
 * propose candidates for a human to confirm.
 *
 * WHY null: the squash keeps [a-z0-9] only, so every Cyrillic, Arabic, Hebrew, CJK, Korean, Greek or Thai name (and
 * "---") squashes to nothing. As `""` that read as data at two call sites: a junk set containing `""` detached real
 * employers (2026-10-08, "АО «Системы управления»" and "مؤسسه تراتيل" lost their text), and
 * `anything.startsWith("")` is true, so an unordered SELECT made an arbitrary company the repoint target of "日本".
 * "Could not normalize" is not a value, so the type no longer lets a caller treat it as one.
 *
 * The SQL copies (companyMerge/db.ts, nonCompanyEmployers/db.ts) cannot return null from a regexp_replace; they stay
 * `''` and are safe because each guards it in SQL (`sq_squash <> ''`) or only uses it as a prefilter whose JS
 * matcher decides.
 */
export const squashCompanyKey = (key: string): string | null => {
  const squashed = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squashed === "" ? null : squashed;
};
