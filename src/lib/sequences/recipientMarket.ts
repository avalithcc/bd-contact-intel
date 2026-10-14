/**
 * Which compliance market (and so which postal address) applies to a Contact. Pure.
 *
 * Fed by the Contact's `country` ONLY, through the existing classifyMarket. City and region are deliberately not
 * used: a bare city is ambiguous ("Cordoba", "Valencia"), and a wrong address is a compliance failure, so anything the
 * country cannot resolve falls through to `other`, which the footer builder refuses to send for (hold, never send).
 */
import { classifyMarket, type MarketKey } from "@/lib/hiring/markets";

export interface MarketSubject {
  readonly country?: string | null;
}

export function recipientMarket(contact: MarketSubject): MarketKey {
  const country = contact.country?.trim();
  if (!country) return "other";
  return classifyMarket(country);
}
