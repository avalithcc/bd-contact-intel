// Expected cost of a Lusha action. A reveal is priced from the API's own
// canReveal list cached on the search; there is no price table here. A reveal
// with no cached price list is refused, never guessed.

export type LushaField = "search" | "emails" | "phones";

export interface CanRevealEntry {
  field: string;
  credits: number;
}

/** A contact search costs a single credit (covers up to 25 contacts). */
export const SEARCH_COST = 1;

export type ExpectedCost =
  | { ok: true; credits: number }
  | { ok: false; reason: "no_price_list" | "not_revealable" };

export function expectedCost(
  field: LushaField,
  canReveal: readonly CanRevealEntry[] | null | undefined,
): ExpectedCost {
  if (field === "search") return { ok: true, credits: SEARCH_COST };
  if (!canReveal) return { ok: false, reason: "no_price_list" };
  const entry = canReveal.find((e) => e.field === field);
  if (!entry || !Number.isSafeInteger(entry.credits) || entry.credits < 0) {
    return { ok: false, reason: "not_revealable" };
  }
  return { ok: true, credits: entry.credits };
}
