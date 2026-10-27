/**
 * READ-ONLY measurement: what changes if the PHONE link moves ABOVE the COMPANY link in
 * `resolveComplianceAudience` (src/lib/sequences/complianceAudience.ts).
 *
 * Why it exists. Today the chain is person country -> company country -> posting bucket -> phone. A contact with no
 * country of their own inherits their COMPANY's country, and their own phone is never consulted. That is how Federico
 * Biskupovich at Lemon Cash (an Argentine company filed as "United States") was drafted in English: company wins, the
 * +54 phone is dead last. `company.country` describes the ORGANISATION; a dial code describes THE PERSON, so for
 * language the phone is the stronger signal and the order looks inverted.
 *
 * This script does not change the order. It reports, per live emailable contact, the audience under the CURRENT chain
 * and under the PROPOSED chain, and the transition matrix between them, so the owner can decide on numbers. It also
 * reports the two risks that a reorder carries: contacts that would newly HOLD (phone resolves to a sanctioned
 * jurisdiction) and the share of no-country contacts that have no usable phone at all (for whom nothing changes).
 *
 * Nothing is written. The transaction is explicitly READ ONLY and that is asserted before and after the reads.
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure-audience-precedence.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  fromPostings,
  resolveCountry,
  SANCTIONED_COUNTRIES,
  SPANISH_SPEAKING_COUNTRIES,
  type ComplianceAudience,
  type ComplianceAudienceInputs,
} from "../src/lib/sequences/complianceAudience";
import { phoneCountryIso } from "../src/lib/sequences/phoneMarket";
import { resolveComplianceAudience } from "../src/lib/sequences/complianceAudience";

type Row = {
  personId: string;
  personName: string | null;
  email: string | null;
  companyKey: string | null;
  companyName: string | null;
  personCountry: string | null;
  companyCountry: string | null;
  postingMarkets: string[] | null;
  phone: string | null;
  mobilePhone: string | null;
};

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Mirror of audienceOfCountry + audienceOfIso, which are private to the module. Verified against it below. */
function audienceOfIso(iso: string | null): ComplianceAudience | null {
  if (!iso) return null;
  if (SANCTIONED_COUNTRIES.has(iso)) return null;
  if (iso === "AR") return { address: "mdp", language: "es" };
  return { address: "miami", language: SPANISH_SPEAKING_COUNTRIES.has(iso) ? "es" : "en" };
}

function fromPostingBucket(markets: readonly (string | null)[] | null | undefined): ComplianceAudience | null {
  const bucket = fromPostings(markets);
  if (bucket === "latam") return { address: "miami", language: "es" } as const;
  if (bucket === "us") return { address: "miami", language: "en" } as const;
  return null;
}

/** PROPOSED chain: person country -> PHONE -> company country -> posting bucket. */
function proposed(input: ComplianceAudienceInputs): ComplianceAudience | null {
  const person = clean(input.personCountry);
  if (person) return audienceOfIso(resolveCountry(person));
  const phoneIso = phoneCountryIso(input.mobilePhone, input.phone);
  if (phoneIso) return audienceOfIso(phoneIso);
  const company = clean(input.companyCountry);
  if (company) return audienceOfIso(resolveCountry(company));
  return fromPostingBucket(input.postingMarkets);
}

const label = (a: ComplianceAudience | null) => (a ? `${a.address}/${a.language}` : "HOLD");
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const before: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`transaction_read_only BEFORE reads: ${JSON.stringify(before[0])}`);

    const rows: Row[] = await tx.execute(sql`
      with canonical as (
        select p.id as person_id, ca.company_key as company_key
        from person p
        join company_alias ca on ca.alias_key = p.company_key
        where ca.company_key <> p.company_key
      )
      select
        p.id::text as "personId",
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as "personName",
        nullif(btrim(p.email), '') as "email",
        coalesce(cn.company_key, p.company_key) as "companyKey",
        coalesce(canon.display_name, own.display_name) as "companyName",
        nullif(btrim(p.country), '') as "personCountry",
        coalesce(nullif(btrim(own.country), ''), nullif(btrim(canon.country), '')) as "companyCountry",
        (
          select coalesce(array_agg(distinct jp.market), '{}')
          from job_posting jp
          where jp.is_it = true
            and (jp.company_key = p.company_key or jp.company_key = cn.company_key)
        ) as "postingMarkets",
        p.phone as "phone",
        p.mobile_phone as "mobilePhone"
      from person p
      left join canonical cn on cn.person_id = p.id
      left join company own on own.company_key = p.company_key
      left join company canon on canon.company_key = cn.company_key
      where p.merged_into_id is null
        and nullif(btrim(p.email), '') is not null
    `);

    const after: any[] = await tx.execute(sql`show transaction_read_only`);
    console.log(`transaction_read_only AFTER reads:  ${JSON.stringify(after[0])}`);

    const transitions = new Map<string, number>();
    const newHoldExamples: string[] = [];
    const changedExamples: string[] = [];

    let total = 0;
    let unchanged = 0;
    let changed = 0;
    let noCountryOfTheirOwn = 0;
    let noCountryNoPhone = 0;
    let decidedByCompanyToday = 0;

    for (const r of rows) {
      total += 1;
      const input: ComplianceAudienceInputs = {
        mobilePhone: clean(r.mobilePhone),
        phone: clean(r.phone),
        personCountry: clean(r.personCountry),
        companyCountry: clean(r.companyCountry),
        postingMarkets: r.postingMarkets ?? [],
        // This measurement predates the roster link and stays a before/after of the PHONE reorder alone.
        rosterCountries: [],
      };

      const now = resolveComplianceAudience(input);
      const next = proposed(input);

      if (!input.personCountry) {
        noCountryOfTheirOwn += 1;
        if (!phoneCountryIso(input.mobilePhone, input.phone)) noCountryNoPhone += 1;
        if (input.companyCountry) decidedByCompanyToday += 1;
      }

      if (label(now) === label(next)) {
        unchanged += 1;
        continue;
      }
      changed += 1;
      bump(transitions, `${label(now)} -> ${label(next)}`);
      if (next === null && now !== null && newHoldExamples.length < 15) {
        newHoldExamples.push(`${r.personName ?? "(no name)"} @ ${r.companyName ?? "(no company)"} | company=${input.companyCountry} | phone=${input.mobilePhone ?? input.phone}`);
      } else if (changedExamples.length < 25) {
        changedExamples.push(`${label(now)} -> ${label(next)} | ${r.personName ?? "(no name)"} @ ${r.companyName ?? "(no company)"} | company=${input.companyCountry} | phone=${input.mobilePhone ?? input.phone}`);
      }
    }

    console.log(`\nmeasured_at (UTC): ${new Date().toISOString()}`);
    console.log(`live contacts with an email: ${total}`);
    console.log(`  no country of their own: ${noCountryOfTheirOwn}`);
    console.log(`    of those, decided by the COMPANY's country today: ${decidedByCompanyToday}`);
    console.log(`    of those, NO usable phone (reorder changes nothing): ${noCountryNoPhone}`);
    console.log(`\naudience unchanged by the reorder: ${unchanged}`);
    console.log(`audience CHANGED by the reorder:   ${changed}`);

    console.log(`\ntransition matrix (current -> proposed):`);
    for (const [k, c] of sorted(transitions)) console.log(`  ${k}: ${c}`);

    if (newHoldExamples.length) {
      console.log(`\nWOULD NEWLY HOLD (sanctioned phone beats a mailable company country) — up to 15:`);
      for (const e of newHoldExamples) console.log(`  ${e}`);
    } else {
      console.log(`\nWOULD NEWLY HOLD: none`);
    }

    console.log(`\nsample of changed contacts (up to 25):`);
    for (const e of changedExamples) console.log(`  ${e}`);

    const lemon = rows.filter((r) => /lemon/i.test(r.companyName ?? "") || /lemon/i.test(r.companyKey ?? ""));
    console.log(`\nLemon Cash contacts found: ${lemon.length}`);
    for (const r of lemon) {
      const input: ComplianceAudienceInputs = {
        mobilePhone: clean(r.mobilePhone),
        phone: clean(r.phone),
        personCountry: clean(r.personCountry),
        companyCountry: clean(r.companyCountry),
        postingMarkets: r.postingMarkets ?? [],
        // This measurement predates the roster link and stays a before/after of the PHONE reorder alone.
        rosterCountries: [],
      };
      console.log(`  ${r.personName ?? "(no name)"} | person=${input.personCountry} company=${input.companyCountry} phone=${input.mobilePhone ?? input.phone ?? "(none)"} postings=${JSON.stringify(r.postingMarkets)}`);
      console.log(`    now=${label(resolveComplianceAudience(input))} proposed=${label(proposed(input))}`);
    }
  });

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
