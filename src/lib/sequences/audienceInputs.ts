/**
 * The ONE place a database row becomes the inputs of the compliance audience. Every reader selects `audienceFactsSql`
 * (rosterQuery.ts) and maps with this, so the view, the draft, the approval, the release and the unsubscribe page cannot
 * disagree about which facts the resolver saw. Pure, no I/O.
 *
 * A column that is `undefined` means the read forgot it, and that throws: resolving without the roster would quietly give a
 * different audience than every other reader (the failure this file exists to prevent). `null` is a real "none".
 */
import type { ColleagueCountry, ComplianceAudienceInputs } from "./complianceAudience";

export const AUDIENCE_FACT_COLUMNS = ["person_country", "mobile_phone", "phone", "company_country", "posting_markets", "roster_countries"] as const;

export function audienceInputsFromRow(r: Record<string, unknown>): ComplianceAudienceInputs {
  for (const column of AUDIENCE_FACT_COLUMNS) {
    if (r[column] === undefined) throw new Error(`audience read is missing the "${column}" column`);
  }
  const roster = (r.roster_countries as { country: unknown; n: unknown }[] | null) ?? [];
  const rosterCountries: ColleagueCountry[] = roster.map((c) => ({ country: String(c.country), n: Number(c.n) }));
  return {
    mobilePhone: r.mobile_phone as string | null,
    phone: r.phone as string | null,
    personCountry: r.person_country as string | null,
    companyCountry: r.company_country as string | null,
    postingMarkets: (r.posting_markets as string[] | null) ?? [],
    rosterCountries,
  };
}
