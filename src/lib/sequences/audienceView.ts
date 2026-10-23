/**
 * What the Sequence member card shows about the draft's audience: the answer of `explainComplianceAudience` (the one chain,
 * so the card and the draft cannot disagree) plus two facts that make the reason actionable. Pure, no I/O.
 */
import { explainComplianceAudience, resolveCountry, type ComplianceAudienceExplained, type ComplianceAudienceInputs } from "./complianceAudience";
import { phoneCountryIso } from "./phoneMarket";

/** Colleagues of the same company that have a country of their own, grouped by the text filed (as the read returns them). */
export interface ColleagueCountry { readonly country: string; readonly n: number }

export interface MemberAudienceRaw extends ComplianceAudienceInputs {
  /** Other live emailable contacts at the same company with no country of their own: the ones the company country decides. */
  readonly companyDecides: number;
  readonly colleagueCountries: readonly ColleagueCountry[];
}

export interface CompanyImpact {
  /** How many OTHER contacts this company's country decides. */
  readonly decides: number;
  /** Colleagues whose own country resolves to a different ISO than the company's. */
  readonly contradicting: number;
  /** The filed text of the most common contradicting country. */
  readonly topCountry: string;
}

export interface MemberAudience extends ComplianceAudienceExplained {
  /** ISO of the country behind the reason (null for the postings bucket, which names none, and for a HOLD). */
  readonly iso: string | null;
  /** A phone is on file but is not what decided: its number and the country its dial code places. */
  readonly unusedPhone: { readonly number: string; readonly iso: string } | null;
  /** Only when the company country decided and a colleague contradicts it. */
  readonly companyImpact: CompanyImpact | null;
}

export function buildMemberAudience(raw: MemberAudienceRaw): MemberAudience {
  const explained = explainComplianceAudience(raw);
  const { reason, evidence } = explained;
  const iso = reason === "person_country" || reason === "company_country" ? resolveCountry(evidence) : reason === "phone" ? phoneCountryIso(evidence, null) : null;

  let unusedPhone: MemberAudience["unusedPhone"] = null;
  if (reason === "company_country" || reason === "posting_markets") {
    const number = [raw.mobilePhone, raw.phone].find((n) => phoneCountryIso(n, null) !== null)?.trim();
    const phoneIso = number ? phoneCountryIso(number, null) : null;
    if (number && phoneIso) unusedPhone = { number, iso: phoneIso };
  }

  let companyImpact: CompanyImpact | null = null;
  if (reason === "company_country" && iso) {
    const against = raw.colleagueCountries.filter((c) => { const r = resolveCountry(c.country); return r !== null && r !== iso; });
    const contradicting = against.reduce((sum, c) => sum + c.n, 0);
    if (contradicting > 0) {
      const top = against.reduce((a, b) => (b.n > a.n ? b : a));
      companyImpact = { decides: raw.companyDecides, contradicting, topCountry: top.country };
    }
  }
  return { ...explained, iso, unusedPhone, companyImpact };
}
