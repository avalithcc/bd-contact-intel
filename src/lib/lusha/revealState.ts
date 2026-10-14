// Resolves what the reveal control should show for one field, from the latest
// ledger row per field. Pure: the caller reads the rows and the day's spend
// (Number()-coerced) and passes them in. Only SETTLED rows count; a failed or
// in-flight row never blocks a retry (the reservation guard handles a double
// click).

import { evaluateCap } from "./cap";
import type { LushaConfigResult } from "./config";
import { SEARCH_COST, expectedCost, type CanRevealEntry } from "./pricing";

export interface LedgerRow {
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
  return Array.isArray(list) ? (list as CanRevealEntry[]) : null;
}

export function resolveRevealState(
  field: "emails" | "phones",
  rows: LatestRows,
  cap: { spentToday: number; cap: number },
  config: LushaConfigResult,
): RevealState {
  if (!config.ok) return config.reason === "not_production" ? { kind: "off" } : { kind: "unconfigured", missing: config.missing };

  const search = settled(rows.search);
  const own = settled(rows[field]);
  // Compliance is permanent (D6) and covers the whole Contact, both fields.
  if ([search, settled(rows.emails), settled(rows.phones)].some((r) => r?.outcome === "compliance_restricted")) return { kind: "blocked" };
  if (own?.outcome === "revealed") return { kind: "revealed", value: own.value };

  const gate = (needed: number, open: RevealState): RevealState => {
    if (needed === 0) return open;
    const d = evaluateCap({ ...cap, expected: needed });
    return d.allowed ? open : { kind: "capped", remaining: d.remaining, needed };
  };

  if (!search || (search.outcome !== "matched" && search.outcome !== "no_match" && search.outcome !== "match_rejected")) {
    return gate(SEARCH_COST, { kind: "searchable", cost: SEARCH_COST });
  }
  if (search.outcome === "match_rejected") return { kind: "rejected", retryCost: SEARCH_COST };
  if (search.outcome === "no_match") return { kind: "unavailable", reason: "no_match", retry: true };
  if (own?.outcome === "no_value") return { kind: "unavailable", reason: "no_value", retry: true };

  const price = expectedCost(field, canRevealOf(search.payload));
  if (!price.ok) return { kind: "unavailable", reason: "not_revealable", retry: false };
  return gate(price.credits, { kind: "revealable", price: price.credits });
}
