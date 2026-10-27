/**
 * What the Sequence member card shows about the draft's audience: the answer of `explainComplianceAudience` (the one chain,
 * so the card and the draft cannot disagree) plus the facts that make the reason actionable. Pure, no I/O.
 */
import { explainComplianceAudience, resolveCountry, rosterBreakdown, type ComplianceAudienceExplained, type ComplianceAudienceInputs } from "./complianceAudience";
import { countryNameEs } from "./countryDisplay";
import { phoneCountryIso } from "./phoneMarket";

/**
 * One country held by some recognized colleagues of the contact. `name` is its Spanish name, resolved HERE (the server) and not
 * in the card: the card renders on the client too, where `Intl.DisplayNames` may come from a different ICU build than the server's.
 */
export interface ColleagueIso { readonly iso: string; readonly n: number; readonly name: string }

export interface MemberAudience extends ComplianceAudienceExplained {
  /** ISO of the country behind the reason (null for the postings bucket, which names none, and for a HOLD with no country). */
  readonly iso: string | null;
  /** The Spanish name of `iso`, resolved on the server (see ColleagueIso); null when `iso` is. */
  readonly isoName: string | null;
  /**
   * The company country as filed, only when the card has to say it was NOT used: the colleagues' majority outvoted it. Null when
   * the company country decided (even with dissent: see `colleaguesDisagree`) or was never filed.
   */
  readonly companyIgnored: string | null;
  /** A phone is on file but is not what decided: its number and the country its dial code places. */
  readonly unusedPhone: { readonly number: string; readonly iso: string } | null;
  /** Recognized colleagues by country, biggest first: the breakdown the card quotes when the roster is split. */
  readonly colleagueCountries: readonly ColleagueIso[];
  /** How many colleagues have a recognized country (the denominator of every roster sentence). */
  readonly colleaguesKnown: number;
}

export function buildMemberAudience(raw: ComplianceAudienceInputs): MemberAudience {
  const explained = explainComplianceAudience(raw);
  const { reason, evidence } = explained;
  const iso =
    reason === "person_country" || reason === "company_country" ? resolveCountry(evidence)
    : reason === "roster_consensus" ? evidence // already an ISO
    : reason === "phone" ? phoneCountryIso(evidence, null)
    : null;

  let unusedPhone: MemberAudience["unusedPhone"] = null;
  if (reason === "company_country" || reason === "posting_markets") {
    const number = [raw.mobilePhone, raw.phone].find((n) => phoneCountryIso(n, null) !== null)?.trim();
    const phoneIso = number ? phoneCountryIso(number, null) : null;
    if (number && phoneIso) unusedPhone = { number, iso: phoneIso };
  }

  const colleagueCountries = rosterBreakdown(raw.rosterCountries).map((c) => ({ ...c, name: countryNameEs(c.iso) }));
  const filed = raw.companyCountry?.trim() || null;
  const companyIgnored = filed && reason === "roster_consensus" && resolveCountry(filed) !== iso ? filed : null;
  return { ...explained, iso, isoName: iso ? countryNameEs(iso) : null, companyIgnored, unusedPhone, colleagueCountries, colleaguesKnown: colleagueCountries.reduce((sum, c) => sum + c.n, 0) };
}
