/**
 * Which compliance market (and so which postal address) applies to a Contact. Pure.
 *
 * Fallback chain, first link with data wins:
 *   1. person.country   most specific: where the human is
 *   2. company.country
 *   3. the markets of the company's open IT postings (job_posting.market, already classified). Read with
 *      `openPostingSql` (open, NO freshness window): this is a geography question, not a hiring one, so an aged-out
 *      posting still locates the recipient. A Contact is seeded because the company had a FRESH posting, but may later
 *      have no country and no fresh posting; the open one still resolves the market. A company whose postings all
 *      closed yields no markets and falls to `other` (hold).
 *   4. the dial code of the person's phone (phoneMarket.ts), consulted LAST and only when no country at all resolved and
 *      the postings did not decide. Last on purpose: a contact that resolves a market today through links 1-3 can never
 *      change market because of a phone. Never stored; see phoneMarket.ts for why person.country is not written.
 *
 * A link "has data" when its value is non-empty. A country that is present but unmapped (e.g. Spain) DECIDES `other`
 * and does not fall through: the person is known to be somewhere we have no address for, and guessing from a posting
 * would put the wrong country's address in the message. Link 3 only resolves when its non-`other` markets agree;
 * none, or a us/latam conflict, is `other`. `other` is the hold-and-do-not-send result, never a default address. The same holds
 * for link 4: it is reached only when there is no country, so a Spanish contact with an Argentine phone stays `other`.
 */
import { classifyMarket, isMarketKey, type MarketKey } from "@/lib/hiring/markets";
import { phoneCountryName } from "./phoneMarket";

/**
 * The two phone fields are REQUIRED (null when the person has none), unlike the country links. This resolver is the one rule
 * the picker, the add guard, the draft, the release and the unsubscribe page must share; an optional field would let one of
 * them skip the phone and disagree with the others about who gets a footer. Required, the compiler lists every caller.
 */
export interface MarketInputs {
  readonly mobilePhone: string | null;
  readonly phone: string | null;
  readonly personCountry?: string | null;
  readonly companyCountry?: string | null;
  /** job_posting.market of the company's open IT postings; null where the backfill has not run. */
  readonly postingMarkets?: readonly (string | null)[] | null;
}

/**
 * Canada resolves to the `us` bucket because the sender's US entity and an English draft are the correct posture
 * for a Canadian recipient. This key selects a compliance posture and a draft language, not a nationality; it is not
 * a claim that Canada is the United States. The rule lives here, NOT in classifyMarket, because classifyMarket also
 * feeds the hiring signal and Canadian job postings must stay out of the `us` hiring market. Exact match on the
 * country field only, so a look-alike never rides along; every other unmapped country still resolves to `other`.
 */
const CANADA = /^canada$/i;

export function marketOfCountry(country: string): MarketKey {
  const market = classifyMarket(country);
  return market === "other" && CANADA.test(country) ? "us" : market;
}

export function fromPostings(markets: readonly (string | null)[] | null | undefined): MarketKey {
  const known = new Set<MarketKey>();
  for (const m of markets ?? []) {
    if (isMarketKey(m) && m !== "other") known.add(m);
  }
  return known.size === 1 ? [...known][0] : "other";
}

export function recipientMarket(input: MarketInputs): MarketKey {
  const person = input.personCountry?.trim();
  if (person) return marketOfCountry(person);
  const company = input.companyCountry?.trim();
  if (company) return marketOfCountry(company);
  const posted = fromPostings(input.postingMarkets);
  if (posted !== "other") return posted;
  const phoneCountry = phoneCountryName(input.mobilePhone, input.phone);
  return phoneCountry ? marketOfCountry(phoneCountry) : "other";
}
