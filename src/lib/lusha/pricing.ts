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
  // The same field listed twice: take the highest price, the number gates a spend.
  let price: number | null = null;
  for (const e of canReveal) {
    if (e.field !== field) continue;
    if (!Number.isSafeInteger(e.credits) || e.credits < 0) return { ok: false, reason: "not_revealable" };
    price = price === null ? e.credits : Math.max(price, e.credits);
  }
  if (price === null) return { ok: false, reason: "not_revealable" };
  return { ok: true, credits: price };
}

/**
 * Cost to cap-check a reveal: the field price plus the search when no search
 * is stored yet. Use this, not expectedCost, as the cap input for a reveal.
 */
export function expectedCostFirstReveal(input: {
  field: "emails" | "phones";
  canReveal: readonly CanRevealEntry[] | null | undefined;
  hasStoredSearch: boolean;
}): ExpectedCost {
  const price = expectedCost(input.field, input.canReveal);
  if (!price.ok) return price;
  return { ok: true, credits: price.credits + (input.hasStoredSearch ? 0 : SEARCH_COST) };
}
