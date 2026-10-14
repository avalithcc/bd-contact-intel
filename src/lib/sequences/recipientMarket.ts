/**
 * Which compliance market (and so which postal address) applies to a Contact. Pure.
 *
 * Fallback chain, first link with data wins:
 *   1. person.country   most specific: where the human is
 *   2. company.country
 *   3. the markets of the company's open IT postings (job_posting.market, already classified). A Contact can only be in
 *      a Sequence because their company has an open IT posting, so this link exists by construction.
 *
 * A link "has data" when its value is non-empty. A country that is present but unmapped (e.g. Spain) DECIDES `other`
 * and does not fall through: the person is known to be somewhere we have no address for, and guessing from a posting
 * would put the wrong country's address in the message. Link 3 only resolves when its non-`other` markets agree;
 * none, or a us/latam conflict, is `other`. `other` is the hold-and-do-not-send result, never a default address.
 */
import { classifyMarket, isMarketKey, type MarketKey } from "@/lib/hiring/markets";

export interface MarketInputs {
  readonly personCountry?: string | null;
  readonly companyCountry?: string | null;
  /** job_posting.market of the company's open IT postings; null where the backfill has not run. */
  readonly postingMarkets?: readonly (string | null)[] | null;
}

function fromPostings(markets: readonly (string | null)[] | null | undefined): MarketKey {
  const known = new Set<MarketKey>();
  for (const m of markets ?? []) {
    if (isMarketKey(m) && m !== "other") known.add(m);
  }
  return known.size === 1 ? [...known][0] : "other";
}

export function recipientMarket(input: MarketInputs): MarketKey {
  const person = input.personCountry?.trim();
  if (person) return classifyMarket(person);
  const company = input.companyCountry?.trim();
  if (company) return classifyMarket(company);
  return fromPostings(input.postingMarkets);
}
