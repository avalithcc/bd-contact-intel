import { db } from "@/db";
import { normalizePickerQuery, toPickerCompany, type PickerCompany, type PickerRow } from "@/lib/companies/companyPicker";
import { buildCompanyPickerQuery } from "@/lib/companies/companyPickerQuery";
import { createTtlCache } from "@/lib/ttlCache";

const run = async (query: string): Promise<PickerCompany[]> => {
  const rows = (await db.execute(buildCompanyPickerQuery(query))) as unknown as PickerRow[];
  return rows.map(toPickerCompany);
};

/**
 * The empty-query list (the companies with the most contacts) is cached in-process for 5 minutes.
 *
 * Measured with EXPLAIN ANALYZE against production (14,657 companies, ~27k persons) on 2026-10-21: a
 * typed search costs 64-107 ms, the same class as the existing /companies search, but this one costs
 * **862 ms** -- it groups every person row by company just to take the top 8. That is most of a second
 * of dialog-open latency, and most of a second holding a pooler slot, on a pool whose real ceiling is 35
 * and which saturated earlier that same day. It fires every time a BD opens the new-contact dialog.
 *
 * What goes stale: which eight companies have the most contacts, for up to 5 minutes, per serverless
 * instance. Harmless by construction -- it is a convenience list shown before anyone types, every entry
 * is a real company, and the first keystroke replaces it with a live search. Nothing is validated
 * against it.
 *
 * Only the EMPTY query is cached. A typed query is not: it is already cheap, and caching per query would
 * need a key per keystroke, which is a memory leak wearing a cache's clothes. The dialog already caches
 * its own answers for its own lifetime.
 */
const topCompaniesCache = createTtlCache(() => run(""), { ttlMs: 5 * 60_000 });

/** Companies for the new-contact dialog's autocomplete. One round trip, at most PICKER_MAX rows. */
export async function searchCompanyPicker(rawQuery: unknown): Promise<PickerCompany[]> {
  // The SAME normaliser the query builder uses, not a local trim: `normalizePickerQuery` also treats a
  // one-character query as empty, so testing `rawQuery.trim()` here let "a" miss the cache and run the
  // 862 ms top-companies statement on every call -- reachable in a loop by any signed-in BD, on a pool
  // whose real ceiling is 35. The normalised value is passed on, so the cache key and the statement can
  // never disagree about what "empty" means.
  const q = normalizePickerQuery(typeof rawQuery === "string" ? rawQuery : "");
  return q === "" ? topCompaniesCache.get() : run(q);
}
