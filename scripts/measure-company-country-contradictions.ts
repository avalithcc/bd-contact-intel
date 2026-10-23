/**
 * READ-ONLY measurement: companies whose OWN ROSTER contradicts their `company.country`.
 *
 * Why this signal and not the domain. A company's country decides the language and the legal footer of every contact
 * there who has no country of their own (1777 live contacts, measured 2026-10-23). Lemon Cash is an Argentine company
 * filed as "United States", which is how a prospect got an English draft. The obvious repair — infer the country from a
 * `.ar` domain — is wrong: Amazon has amazon.com.ar and is correctly US. And the phone does not rescue these contacts
 * either: Lemon Cash's five people have no phone at all.
 *
 * The signal that needs no guessing: inside the same company, some contacts DO have their own `person.country`. Where
 * those disagree with the company's, the company's field is suspect by its own data. This script ranks those
 * contradictions by how many contacts the wrong value is currently deciding for, so the repair can start where it is
 * actually costing emails. Nothing is inferred and nothing is written: the output is a review list.
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure-company-country-contradictions.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  resolveCountry,
  SANCTIONED_COUNTRIES,
  SPANISH_SPEAKING_COUNTRIES,
} from "../src/lib/sequences/complianceAudience";

type Row = {
  companyKey: string;
  companyName: string | null;
  companyCountry: string;
  domain: string | null;
  rosterCountries: string[] | null;
  contactsWithOwnCountry: number;
  contactsDecidedByCompany: number;
};

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * The audience of an ISO code, mirroring the module's private `audienceOfCountry`.
 *
 * It takes an ISO, NOT free text, and that distinction cost a wrong measurement: the first version of this script fed
 * ISO codes ("AR") to `resolveCountry`, which rejects bare codes on purpose (complianceAudience.ts: a region must never
 * match on its own code), so every roster country labelled as HOLD and the "changes the email" count was trivially
 * equal to the total. Keep the two entry points apart.
 */
const labelOfIso = (iso: string | null): string => {
  if (!iso) return "HOLD";
  if (SANCTIONED_COUNTRIES.has(iso)) return "HOLD";
  if (iso === "AR") return "mdp/es";
  return SPANISH_SPEAKING_COUNTRIES.has(iso) ? "miami/es" : "miami/en";
};

/** The audience of a free-text country, the way `company.country` and `person.country` are actually stored. */
const labelOfText = (text: string | null): string => labelOfIso(resolveCountry(text));

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const before: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`transaction_read_only BEFORE reads: ${JSON.stringify(before[0])}`);

    const rows: Row[] = await tx.execute(sql`
      with live as (
        select
          p.company_key,
          nullif(btrim(p.country), '') as person_country
        from person p
        where p.merged_into_id is null
          and nullif(btrim(p.email), '') is not null
      )
      select
        c.company_key as "companyKey",
        c.display_name as "companyName",
        btrim(c.country) as "companyCountry",
        c.domain as "domain",
        (
          select coalesce(array_agg(distinct l.person_country), '{}')
          from live l
          where l.company_key = c.company_key and l.person_country is not null
        ) as "rosterCountries",
        (select count(*) from live l where l.company_key = c.company_key and l.person_country is not null)::int as "contactsWithOwnCountry",
        (select count(*) from live l where l.company_key = c.company_key and l.person_country is null)::int as "contactsDecidedByCompany"
      from company c
      where nullif(btrim(c.country), '') is not null
    `);

    const after: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`transaction_read_only AFTER reads:  ${JSON.stringify(after[0])}\n`);

    let withCountry = 0;
    let contradicted = 0;
    let contradictedUnanimous = 0;
    let contactsAtRisk = 0;
    let contactsAtRiskUnanimous = 0;
    let audienceWouldChange = 0;

    const report: { line: string; weight: number }[] = [];

    for (const r of rows) {
      withCountry += 1;
      const roster = (r.rosterCountries ?? []).map(clean).filter((v): v is string => Boolean(v));
      if (roster.length === 0) continue;

      const companyIso = resolveCountry(r.companyCountry);
      const rosterIsos = [...new Set(roster.map((v) => resolveCountry(v)).filter((v): v is string => Boolean(v)))];
      if (rosterIsos.length === 0) continue;

      const disagree = rosterIsos.filter((iso) => iso !== companyIso);
      if (disagree.length === 0) continue;

      contradicted += 1;
      contactsAtRisk += r.contactsDecidedByCompany;

      const unanimous = disagree.length === rosterIsos.length && rosterIsos.length >= 1 && disagree.length === 1;
      if (unanimous) {
        contradictedUnanimous += 1;
        contactsAtRiskUnanimous += r.contactsDecidedByCompany;
      }

      // Does the contradiction actually change the email? Same audience = harmless mislabel.
      const companyLabel = labelOfText(r.companyCountry);
      const rosterLabels = [...new Set(rosterIsos.map(labelOfIso))];
      const changesEmail = rosterLabels.some((l) => l !== companyLabel);
      if (changesEmail && r.contactsDecidedByCompany > 0) audienceWouldChange += r.contactsDecidedByCompany;

      if (changesEmail) {
        report.push({
          weight: r.contactsDecidedByCompany,
          line:
            `  ${r.companyName ?? r.companyKey} | filed=${r.companyCountry} (${companyLabel})` +
            ` | roster says=${roster.join(", ")} (${rosterLabels.join(", ")})` +
            ` | ${r.contactsDecidedByCompany} contact(s) decided by the company, ${r.contactsWithOwnCountry} with their own` +
            ` | domain=${r.domain ?? "(none)"}${unanimous ? " | UNANIMOUS" : ""}`,
        });
      }
    }

    console.log(`measured_at (UTC): ${new Date().toISOString()}`);
    console.log(`companies with a country on file: ${withCountry}`);
    console.log(`  contradicted by their own roster: ${contradicted}`);
    console.log(`    where the roster is UNANIMOUS against the company: ${contradictedUnanimous}`);
    console.log(`\nlive no-country contacts currently decided by a contradicted country: ${contactsAtRisk}`);
    console.log(`  of those, behind a UNANIMOUS contradiction: ${contactsAtRiskUnanimous}`);
    console.log(`  of those, where the contradiction actually CHANGES the email (address or language): ${audienceWouldChange}`);

    report.sort((a, b) => b.weight - a.weight);
    console.log(`\ncontradictions that change the email, by contacts affected (top 30 of ${report.length}):`);
    for (const r of report.slice(0, 30)) console.log(r.line);
  });

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
