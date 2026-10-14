// Resolves what the reveal control should show for one field, from the latest
// ledger row per field. Pure: the caller reads the rows and the day's spend
// (Number()-coerced) and passes them in. Only SETTLED rows count; a failed or
// in-flight row never blocks a retry (the reservation guard handles a double
// click).

import { evaluateCap } from "./cap";
import type { LushaConfigResult } from "./config";
import { SEARCH_COST, expectedCost, type CanRevealEntry } from "./pricing";

export interface LedgerRow {
  /** This row's own id. */
  id: string;
  /**
   * The search row that produced this row: a field row carries its search's id, a search
   * row carries its own. A field row is only trusted for the CURRENT search, so a stale
   * no_value / revealed from an old (rejected) match can never win over a re-search.
   */
  searchId: string | null;
  /** When the row was written; readers order by it (latest per field). */
  at: Date | string;
  field: "search" | "emails" | "phones";
  state: "reserved" | "settled" | "failed";
  outcome: string | null;
  value: string | null;
  payload: unknown;
}

export interface LatestRows {
  search?: LedgerRow | null;
  emails?: LedgerRow | null;
  phones?: LedgerRow | null;
  /**
   * True when ANY row of this Contact, from any search, is a compliance restriction.
   * Compliance is permanent across searches (D6); the latest-row-per-field input cannot
   * see an older one, so the reader supplies this.
   */
  complianceBlocked?: boolean;
}

export type RevealState =
  | { kind: "off" }
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "searchable"; cost: number }
  | { kind: "revealable"; price: number }
  | { kind: "unavailable"; reason: "no_match" | "no_value" | "not_revealable"; retry: boolean }
  | { kind: "rejected"; retryCost: number }
  | { kind: "blocked" }
  | { kind: "revealed"; value: string | null }
  | { kind: "capped"; remaining: number; needed: number };

const settled = (r: LedgerRow | null | undefined): LedgerRow | null => (r && r.state === "settled" ? r : null);

function canRevealOf(payload: unknown): CanRevealEntry[] | null {
  const list = typeof payload === "object" && payload !== null ? (payload as { canReveal?: unknown }).canReveal : null;
  if (!Array.isArray(list)) return null;
  return list.filter((e): e is CanRevealEntry => typeof e === "object" && e !== null && !Array.isArray(e));
}

export function resolveRevealState(
  field: "emails" | "phones",
  rows: LatestRows,
  cap: { spentToday: number; cap: number },
  config: LushaConfigResult,
): RevealState {
  if (!config.ok) return config.reason === "not_production" ? { kind: "off" } : { kind: "unconfigured", missing: config.missing };

  const search = settled(rows.search);
  // A field row only counts for the search that produced it.
  const tied = (r: LedgerRow | null | undefined): LedgerRow | null => {
    const row = settled(r);
    return row && search && row.searchId === search.id ? row : null;
  };
  const own = tied(rows[field]);
  // Compliance is permanent (D6): it covers the whole Contact, both fields, every search.
  if (rows.complianceBlocked || [search, settled(rows.emails), settled(rows.phones)].some((r) => r?.outcome === "compliance_restricted")) {
    return { kind: "blocked" };
  }
  // A revealed VALUE is person-level: we own it whichever search paid for it. Only negative outcomes are search-scoped.
  const paid = settled(rows[field]);
  if (paid?.outcome === "revealed") return { kind: "revealed", value: paid.value };

  // Every spend, including a free-looking one and every retry, goes through the cap: a
  // stale price of 0 must never present itself as an uncapped action.
  const gate = (needed: number, open: RevealState): RevealState => {
    const d = evaluateCap({ ...cap, expected: needed });
    return d.allowed ? open : { kind: "capped", remaining: d.remaining, needed };
  };

  if (!search || (search.outcome !== "matched" && search.outcome !== "no_match" && search.outcome !== "match_rejected")) {
    return gate(SEARCH_COST, { kind: "searchable", cost: SEARCH_COST });
  }
  if (search.outcome === "match_rejected") return gate(SEARCH_COST, { kind: "rejected", retryCost: SEARCH_COST });
  if (search.outcome === "no_match") return gate(SEARCH_COST, { kind: "unavailable", reason: "no_match", retry: true });
  if (own?.outcome === "no_value") return gate(SEARCH_COST, { kind: "unavailable", reason: "no_value", retry: true });

  const price = expectedCost(field, canRevealOf(search.payload));
  if (!price.ok) return { kind: "unavailable", reason: "not_revealable", retry: false };
  return gate(price.credits, { kind: "revealable", price: price.credits });
}

/** A ledger row as the reader selects it: LedgerRow plus the per-contact compliance flag. */
export type ReadRow = LedgerRow & { blocked: boolean };

/** Folds the reader's rows (one per field, latest) into resolveRevealState's input. */
export function toLatestRows(rows: readonly ReadRow[]): LatestRows {
  const out: LatestRows = { complianceBlocked: rows.some((r) => r.blocked) };
  for (const { blocked: _blocked, ...row } of rows) out[row.field] = row;
  return out;
}
