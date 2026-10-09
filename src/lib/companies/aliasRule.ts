import { sql } from "drizzle-orm";
import { company, companyAlias } from "@/db/schema";

/**
 * The ONE rule for which `company_alias` rows are real aliases, shared by the
 * list's alias read (aliasResolutionDb.ts) and the record's condition
 * (`companyContactsCondition`, contactCounts.ts): an alias key that is itself a
 * live `company` key is not an alias for anyone — that company owns its key.
 *
 * Why it must be asked of the database and not decided in JS: a JS skip like
 * "ignore aliases that are another requested key" depends on which companies
 * happen to be on the page, so the same company showed different counts on
 * different pages, and the record (which has no page) double-counted. Asking
 * the database makes the answer page-independent and identical on both sides.
 *
 * Latent today: merge-companies.ts deletes the dead `company` row before it
 * writes the alias, so a merge never leaves one. But nothing enforces it:
 * `company_alias` has only `alias_key` as primary key and an FK from
 * `company_key`. Exactly two places write alias rows - companyMerge/db.ts:200
 * (safe, as above) and scripts/seed-target-companies.ts:99, which upserts its
 * hand-written `aliases` list with `on conflict (alias_key) do update` and NO
 * check against live company keys. That is the one path that can create a
 * collision. Zero exist in production (checked 2026-10-09). The importers
 * (dff2026, contactosComerciales, hoteles2026) only READ aliases, never write
 * them. Also covers an alias equal to its own company's key (that company is
 * live by the FK).
 *
 * Correlated `NOT EXISTS` on `company`'s primary key: one index probe per
 * alias row, and alias rows are scoped to the asked company first. Measured on
 * production for `banco galicia`: 0.250 ms, `person_company_key_idx` still
 * used for the person lookup.
 */
export function aliasKeyIsNotLiveCompany() {
  return sql`not exists (select 1 from ${company} where ${company.companyKey} = ${companyAlias.aliasKey})`;
}
