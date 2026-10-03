/**
 * Owner-approved one-off load of verified LinkedIn company pages into
 * `company.linkedin_url` (scripts/load-company-linkedin-urls.ts). Pure
 * planner + the verified list; no I/O.
 *
 * Every pair was verified by the strong method: the company's own website
 * links to that LinkedIn page. Pairs that could not be verified that way are
 * not in this list. `displayName` is the stored name verbatim (trailing
 * period, slash, pipe and case included) — it is matched exactly.
 */
import { normalizeCompanyLinkedinUrl } from "@/lib/companies/linkedinUrl";

export interface LinkedinBulkLoadPair {
  displayName: string;
  slug: string;
}

export interface LinkedinBulkLoadMatch {
  companyKey: string;
  linkedinUrl: string | null;
}

export interface LinkedinBulkLoadWrite {
  companyKey: string;
  displayName: string;
  linkedinUrl: string;
}

export type LinkedinBulkLoadSkipReason =
  | "no_match"
  | "multiple_matches"
  | "already_has_linkedin"
  | "rejected_by_normaliser";

export interface LinkedinBulkLoadSkip {
  displayName: string;
  reason: LinkedinBulkLoadSkipReason;
}

export interface LinkedinBulkLoadPlan {
  writes: LinkedinBulkLoadWrite[];
  skips: LinkedinBulkLoadSkip[];
}

const p = (slug: string, displayName: string): LinkedinBulkLoadPair => ({ displayName, slug });

export const LINKEDIN_BULK_LOAD_PAIRS: readonly LinkedinBulkLoadPair[] = [
  p("accenture", "Accenture"),
  p("3556383", "Amalgama"),
  p("amazon", "Amazon"),
  p("america-virtual-sa", "América Virtual"),
  p("applicant---it-talent-management", "Applicant - IT Talent Management"),
  p("arionkoder", "Arionkoder"),
  p("avenga", "Avenga"),
  p("banco-hipotecario", "Banco Hipotecario"),
  p("banco-pichincha-ca", "Banco Pichincha"),
  p("baufest", "Baufest"),
  p("biwares", "Biwares"),
  p("blue-alba", "Blue Alba"),
  p("30576424", "Calm es simple."),
  p("capgemini", "Capgemini"),
  p("cleartechdata", "Clear Tech"),
  p("cognizant", "Cognizant"),
  p("cookunity", "CookUnity"),
  p("darwoft", "Darwoft"),
  p("devlane-team", "Devlane"),
  p("eurekalabs", "Eureka Labs"),
  p("fisagroup", "Fisa Group"),
  p("fligoo", "Fligoo"),
  p("folderit", "Folder IT"),
  p("globallogic", "GlobalLogic"),
  p("iafisgroup", "Iafis Group"),
  p("innovummx", "Innovum"),
  p("intive", "intive"),
  p("invgate", "InvGate"),
  p("jpmorgan-chase", "JPMorgan Chase & Co."),
  p("kenility", "Kenility"),
  p("lightit", "Light-it"),
  p("mobydigital", "MobyDigital"),
  p("multiplica", "Multiplica"),
  p("novacomp", "Novacomp"),
  p("oneinfo-consulting", "OneInfo Consulting"),
  p("opendev-solutions", "OpenDev Pro"),
  p("opentechpy", "opentech"),
  p("pomelo-latam", "Pomelo"),
  p("qactions-srl", "QACTIONS"),
  p("qualis-lab", "Qualis Lab"),
  p("redwood-software", "Redwood Software"),
  p("softtek", "Softtek"),
  p("spyrosoft", "Spyrosoft"),
  p("tecnosoftware", "Tecnosoftware"),
  p("trick-studios", "Trick Studios"),
  p("ual-", "Ualá"),
  p("valkimia", "Valkimia/"),
  p("vortex-it-ok", "VORTEX-IT"),
  p("winclap", "Winclap"),
  p("workia", "Workia | HR Tech"),
];

/**
 * `matchesByName` is keyed by the exact `display_name` string the pair
 * carries (the script looks rows up with that same string). Never mutates
 * its inputs.
 */
export function planLinkedinBulkLoad(
  pairs: readonly LinkedinBulkLoadPair[],
  matchesByName: ReadonlyMap<string, readonly LinkedinBulkLoadMatch[]>,
): LinkedinBulkLoadPlan {
  const writes: LinkedinBulkLoadWrite[] = [];
  const skips: LinkedinBulkLoadSkip[] = [];
  for (const pair of pairs) {
    const found = matchesByName.get(pair.displayName) ?? [];
    if (found.length === 0) {
      skips.push({ displayName: pair.displayName, reason: "no_match" });
      continue;
    }
    if (found.length > 1) {
      skips.push({ displayName: pair.displayName, reason: "multiple_matches" });
      continue;
    }
    const row = found[0]!;
    if (row.linkedinUrl !== null && row.linkedinUrl !== "") {
      skips.push({ displayName: pair.displayName, reason: "already_has_linkedin" });
      continue;
    }
    const normalised = normalizeCompanyLinkedinUrl(`linkedin.com/company/${pair.slug}`);
    // The slug must survive normalisation untouched: a stray `/` or `?` would
    // otherwise be truncated into a different, valid-looking page.
    if (!normalised.ok || normalised.value !== `linkedin.com/company/${pair.slug}`) {
      skips.push({ displayName: pair.displayName, reason: "rejected_by_normaliser" });
      continue;
    }
    writes.push({ companyKey: row.companyKey, displayName: pair.displayName, linkedinUrl: normalised.value });
  }
  return { writes, skips };
}
