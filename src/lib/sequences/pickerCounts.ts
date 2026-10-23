/**
 * The chip counts of the picker, both dimensions, as the page shows them. Pure and client-safe. They come from ONE
 * statement (buildPickerCountsQuery) whose rows say which dimension they belong to; this file splits them back.
 */
import { industryCountsFromRows, type IndustryCounts } from "./industryCounts";

export type CountryCounts = {
  /** Contacts per effective country text (countries with none are absent). */
  byValue: Record<string, number>;
  /**
   * Display names by value, resolved on the SERVER (pageQueries) so the client never runs `Intl.DisplayNames`: Node and the
   * browser ship different ICU builds, and a region name they disagree on would be a hydration mismatch. A value with no entry
   * is shown as stored. Display only: never a filter value.
   */
  labels: Record<string, string>;
  /** Contacts with no effective country: what the "Sin país" chip selects. */
  none: number;
  /** The whole pool under the other filters: byValue + none. */
  total: number;
};

/** Contacts of the pool that carry each checkbox signal: what ticking the box would leave under the other filters. */
export type SignalCounts = { florida: number; hiring: number };

export type CountsRow = { dim: "industry" | "country" | "signal"; val: string | null; n: number | string };
export type PickerCounts = { industry: IndustryCounts; country: CountryCounts; signals: SignalCounts };

export function pickerCountsFromRows(rows: readonly CountsRow[]): PickerCounts {
  const country: CountryCounts = { byValue: {}, labels: {}, none: 0, total: 0 };
  const signals: SignalCounts = { florida: 0, hiring: 0 };
  for (const r of rows) {
    if (r.dim === "signal" && (r.val === "florida" || r.val === "hiring")) signals[r.val] = Number(r.n);
    if (r.dim !== "country") continue;
    const n = Number(r.n);
    country.total += n;
    if (r.val == null) country.none += n;
    else country.byValue[r.val] = (country.byValue[r.val] ?? 0) + n;
  }
  return { industry: industryCountsFromRows(rows.filter((r) => r.dim === "industry").map((r) => ({ industry: r.val, n: r.n }))), country, signals };
}

export type CountryEntry = { value: string; n: number };

/**
 * The country chips: the biggest `top` plus every SELECTED country (a chosen chip must never drop into the tail because the
 * other filters shrank it, nor vanish at 0), then the rest. Biggest first, ties by name. Returns new arrays; inputs untouched.
 */
export function splitCountries(counts: CountryCounts, selected: readonly string[], top = 7): { top: CountryEntry[]; tail: CountryEntry[] } {
  const chosen = new Set(selected);
  const all = new Map<string, number>(Object.entries(counts.byValue));
  for (const v of chosen) if (!all.has(v)) all.set(v, 0);
  const ranked = [...all].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
  const head = new Set(ranked.slice(0, top).map((e) => e.value));
  return { top: ranked.filter((e) => head.has(e.value) || chosen.has(e.value)), tail: ranked.filter((e) => !head.has(e.value) && !chosen.has(e.value)) };
}
