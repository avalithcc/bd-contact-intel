/**
 * The chip counts of the industry filter, as the page shows them. Pure and client-safe. They come from ONE grouped query
 * over the picker's own pool (buildPickerIndustryCountsQuery), so a chip's number is what the list would hold with that
 * chip on and nothing else changed.
 */
import { INDUSTRY_GROUP_KEYS, industryGroupOf, industryValuesOf, type IndustryGroupKey } from "./industryGroups";

export type IndustryCounts = {
  /** Contacts per raw mapped value (values with none are absent). */
  byValue: Record<string, number>;
  /** Contacts whose company has no industry: what the "Sin industria" chip selects. */
  none: number;
  /** Contacts with an industry the mapping does not know; always 0 while the mapping is complete. */
  unmapped: number;
  /** The whole pool: byValue + none + unmapped. */
  total: number;
};

export type IndustryCountRow = { industry: string | null; n: number | string };

export function industryCountsFromRows(rows: readonly IndustryCountRow[]): IndustryCounts {
  const out: IndustryCounts = { byValue: {}, none: 0, unmapped: 0, total: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    out.total += n;
    if (r.industry == null) out.none += n;
    else if (industryGroupOf(r.industry)) out.byValue[r.industry] = (out.byValue[r.industry] ?? 0) + n;
    else out.unmapped += n;
  }
  return out;
}

export const groupCount = (c: IndustryCounts, group: IndustryGroupKey): number => industryValuesOf(group).reduce((s, v) => s + (c.byValue[v] ?? 0), 0);
export const groupCounts = (c: IndustryCounts): Record<IndustryGroupKey, number> => Object.fromEntries(INDUSTRY_GROUP_KEYS.map((k) => [k, groupCount(c, k)])) as Record<IndustryGroupKey, number>;
