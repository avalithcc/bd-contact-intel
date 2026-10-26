/**
 * READ-ONLY measurement: how many sequence-eligible contacts have no legal
 * footer today, and how many of those would be UNBLOCKED by inferring the
 * country from the phone's dial code.
 *
 * Why it exists: the create-sequence picker blocks a contact whose market has
 * no legal footer (reason `unmappedMarket`, src/lib/sequences/pickerView.ts).
 * The owner approved inferring the country from the phone before a backfill is
 * written, so this script measures whether the inference actually closes the
 * gap. The number that matters is NOT "how many get a country" — it is "how
 * many land in a market that HAS a footer", because COMPLIANCE_CONFIG
 * (src/lib/sequences/config.ts) only defines `us` and `latam`. A `+34` phone
 * yields Spain, which still classifies as `other` and stays blocked.
 *
 * Uses the app's own resolver (`resolveComplianceAudience`) so the
 * counts match what the picker and the add guard actually do, including the
 * third link in the chain: the markets of the company's open IT job postings.
 *
 * Nothing is written. Every count prints with its measurement timestamp so it
 * can be pasted into openspec/BACKLOG.md.
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure-unmapped-market.ts
 */
import { sql } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { db } from "../src/db";
import { resolveComplianceAudience } from "../src/lib/sequences/complianceAudience";

type Row = {
  personCountry: string | null;
  companyCountry: string | null;
  postingMarkets: string[] | null;
  phone: string | null;
  mobilePhone: string | null;
};

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The ISO country the phone's dial code points at, or null. */
function countryFromPhone(row: Row): string | null {
  for (const raw of [row.mobilePhone, row.phone]) {
    const value = clean(raw);
    if (!value) continue;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.isValid() && parsed.country) return parsed.country;
  }
  return null;
}

function bump(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sorted(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  // Live persons (a merged-away row is hidden from every read) holding a
  // non-blank email: the population the create-sequence picker lists.
  // The country join mirrors `companyCountrySql`
  // (src/lib/sequences/rosterQuery.ts): own company first, then the canonical
  // company reached through company_alias. Postings mirror postingMarketsSql.
  const rows: Row[] = await db.execute(sql`
    with canonical as (
      select p.id as person_id, ca.company_key as company_key
      from person p
      join company_alias ca on ca.alias_key = p.company_key
      where ca.company_key <> p.company_key
    )
    select
      nullif(btrim(p.country), '') as "personCountry",
      coalesce(
        nullif(btrim(own.country), ''),
        nullif(btrim(canon.country), '')
      ) as "companyCountry",
      (
        select coalesce(array_agg(distinct jp.market), '{}')
        from job_posting jp
        where jp.is_it = true
          and (
            jp.company_key = p.company_key
            or jp.company_key = cn.company_key
          )
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

  const blockedByCountry = new Map<string, number>();
  const unblockedBy = new Map<string, number>();
  const stillBlockedAfter = new Map<string, number>();

  let total = 0;
  let mappedToday = 0;
  let blockedToday = 0;
  let blockedNoCountryNoPhone = 0;
  let blockedPhoneUnparseable = 0;
  let unblocked = 0;
  let stillBlocked = 0;

  for (const row of rows) {
    total += 1;
    // The phones are passed as null on purpose: this script measures the world BEFORE the phone link, and the guess below
    // is its own what-if. With them set, the resolver would apply the link itself and the "blocked today" count would shrink.
    const inputs = {
      mobilePhone: null,
      phone: null,
      personCountry: clean(row.personCountry),
      companyCountry: clean(row.companyCountry),
      postingMarkets: row.postingMarkets ?? [],
    };

    if (resolveComplianceAudience(inputs)) {
      mappedToday += 1;
      continue;
    }

    blockedToday += 1;
    const resolvedCountry = inputs.personCountry ?? inputs.companyCountry;
    bump(blockedByCountry, resolvedCountry ?? "(no country)");

    const guess = countryFromPhone(row);
    if (!guess) {
      const hasPhone = Boolean(clean(row.phone) || clean(row.mobilePhone));
      if (hasPhone) blockedPhoneUnparseable += 1;
      else blockedNoCountryNoPhone += 1;
      stillBlocked += 1;
      bump(stillBlockedAfter, resolvedCountry ?? "(no country, no usable phone)");
      continue;
    }

    // What the inference would change: the phone's country replaces an empty
    // person country. A country that is already set wins over the phone, so
    // only no-country rows can move.
    const wouldResolve = resolvedCountry
      ? resolveComplianceAudience(inputs)
      : resolveComplianceAudience({ ...inputs, personCountry: guess });

    if (wouldResolve) {
      unblocked += 1;
      bump(unblockedBy, `${guess} -> ${wouldResolve.address}/${wouldResolve.language}`);
    } else {
      stillBlocked += 1;
      bump(stillBlockedAfter, resolvedCountry ?? `${guess} (from phone)`);
    }
  }

  console.log(`measured_at (UTC): ${new Date().toISOString()}`);
  console.log(`live contacts with an email: ${total}`);
  console.log(`  market mapped today (has a footer): ${mappedToday}`);
  console.log(`  BLOCKED today (unmappedMarket): ${blockedToday}`);
  console.log(`    of those, no country and no usable phone: ${blockedNoCountryNoPhone}`);
  console.log(`    of those, phone present but unparseable: ${blockedPhoneUnparseable}`);
  console.log(`\nif the country is inferred from the phone:`);
  console.log(`  UNBLOCKED (lands in us or latam): ${unblocked}`);
  console.log(`  still blocked: ${stillBlocked}`);

  console.log("\nblocked today, by resolved country (top 25):");
  for (const [key, count] of sorted(blockedByCountry).slice(0, 25)) {
    console.log(`  ${key}: ${count}`);
  }

  console.log("\nwould be unblocked, by inferred country -> market:");
  for (const [key, count] of sorted(unblockedBy)) {
    console.log(`  ${key}: ${count}`);
  }

  console.log("\nstill blocked after the inference, by country (top 25):");
  for (const [key, count] of sorted(stillBlockedAfter).slice(0, 25)) {
    console.log(`  ${key}: ${count}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
