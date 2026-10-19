// Pure view-model helpers for the Vacantes screen. No "@/db" import so they unit-test without a DATABASE_URL.
import { isMarketKey, type MarketKey } from "./markets";

/**
 * The Vacantes filters that change WHICH postings a company has. Offshore-heavy and startups-only select whole
 * companies and leave a surviving company's postings untouched, so they are deliberately not part of this.
 */
export interface PostingFilter {
  market?: MarketKey;
  miamiOnly?: boolean;
}

/** Validates untrusted `?market=&miamiOnly=` values; Miami is a sub-filter of US, so it is dropped otherwise. */
export function resolvePostingFilter(raw: { market?: string; miamiOnly?: string }): Required<Pick<PostingFilter, "miamiOnly">> & PostingFilter {
  const market = isMarketKey(raw.market) ? raw.market : undefined;
  return { market, miamiOnly: market === "us" && raw.miamiOnly === "on" };
}

export type HiringDelta =
  | { kind: "new" }
  | { kind: "up"; amount: number }
  | { kind: "down"; amount: number }
  | { kind: "none" };

/**
 * `total` is today's counted total, `previous` the total that counted 7 days ago under the same freshness rule
 * (see countedBeforeDeltaWindowSql). The delta is their difference, so aging out, closures and new postings are all
 * included. No change yields "none": the screen shows no badge, so colour keeps meaning something.
 *
 * "new" = nothing counted a week ago. It is a claim about the whole company, so under a market/Miami filter
 * (`filtered`) the view cannot make it and the badge is suppressed: that company reads as a plain rise.
 */
export function hiringDelta(i: { total: number; previous: number; filtered?: boolean }): HiringDelta {
  if (i.total > 0 && i.previous === 0 && !i.filtered) return { kind: "new" };
  const net = i.total - i.previous;
  if (net > 0) return { kind: "up", amount: net };
  if (net < 0) return { kind: "down", amount: -net };
  return { kind: "none" };
}

/** Contacts of a company, by key (a name match would mix "Meta" with "Metalab"): the company record lists them. */
export function companyContactsHref(companyKey: string): string {
  return `/companies/${encodeURIComponent(companyKey)}`;
}

/** The company record opened on its hiring tab (the list behind the vacancy number), by key, under the same filter. */
export function companyPostingsHref(companyKey: string, filter: PostingFilter = {}): string {
  const params = new URLSearchParams({ tab: "hiring" });
  if (filter.market) params.set("market", filter.market);
  if (filter.market === "us" && filter.miamiOnly) params.set("miamiOnly", "on");
  return `/companies/${encodeURIComponent(companyKey)}?${params.toString()}`;
}

/** "+12" / "−2" (real minus sign, as in the mockup). Empty for kinds that show text instead of a number. */
export function formatDeltaAmount(d: HiringDelta): string {
  if (d.kind === "up") return `+${d.amount}`;
  if (d.kind === "down") return `−${d.amount}`;
  return "";
}

export interface MarketCounts {
  latam: number;
  us: number;
  miami: number;
}

/**
 * "31 LATAM · 7 US · 2 Miami", markets with a zero count omitted. The mockup separates with a middle dot, which
 * Intl.ListFormat cannot produce (it yields "a, b y c"), so this joins explicitly; one market needs no separator.
 */
export function marketLine(counts: MarketCounts, labels: Record<keyof MarketCounts, string>): string {
  return (["latam", "us", "miami"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${labels[k]}`)
    .join(" · ");
}

/** Vacancies descending; ties by name so the order never reshuffles between renders. */
export function compareByVacancies(
  a: { displayName: string; openItCount: number },
  b: { displayName: string; openItCount: number },
): number {
  return b.openItCount - a.openItCount || a.displayName.localeCompare(b.displayName);
}
