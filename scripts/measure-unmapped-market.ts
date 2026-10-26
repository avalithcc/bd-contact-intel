/**
 * READ-ONLY measurement: how many contacts with an email cannot be mailed today because no
 * compliance audience can be established (the picker's `unmappedMarket` block), and WHY.
 *
 * It asks `explainComplianceAudience` — THE chain, the same one the picker, the add guard, the
 * draft and the unsubscribe page use — which link decided, instead of re-deriving the rules.
 * The population is read with the chain's own SQL helpers (`companyCountrySql`, `sameCompanyAs`,
 * `openPostingSql`), imported rather than transcribed.
 *
 * ## Why it was rewritten on 2026-10-26 (read this before trusting any older output)
 *
 * The first version answered "would inferring the country from the phone unblock contacts?" and
 * reported 2049 blocked with only 7 unblockable. All three of its parts were wrong:
 *
 *  1. It passed `mobilePhone: null, phone: null` on purpose, to measure "the world before the
 *     phone link". That link has since shipped (`AudienceReason` includes "phone"), so the
 *     counterfactual became the present and the "blocked" count was inflated by ~870.
 *  2. Its what-if fed the phone's ISO CODE into `personCountry`, which parses country NAMES.
 *     `resolveCountry("AR")` is null; only "US" resolved, and only because "us" happens to sit in
 *     ALIASES.US for a different reason. That is the entire origin of the "7".
 *  3. Its query transcribed `companyCountrySql` and the postings subquery instead of importing
 *     them, and the copy lost the open-posting window, so closed postings counted as signal.
 *
 * Measured with this version on 2026-10-26: of 7580 live contacts with an email, 6407 are
 * mailable and 1173 (15.5%) are blocked — and every one of those 1173 is blocked because NO link
 * had any data at all. None is blocked by country text the resolver could not name, and none by a
 * sanctioned jurisdiction. The phone link alone already decides 875 of the mailable ones.
 *
 * So the open question is no longer "does inference help" — it shipped and it did. What is left is
 * contacts with no country, no usable phone and no open IT postings: an enrichment question, not a
 * classification one. Keep this script as the ongoing read of that share.
 *
 * Nothing is written, and the read-only guard lives INSIDE the transaction: `set transaction read
 * only` outside a transaction block is a no-op WARNING (25P01).
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure-unmapped-market.ts
 */
import { sql } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { db } from "../src/db";
import { explainComplianceAudience } from "../src/lib/sequences/complianceAudience";
import { companyCountrySql, sameCompanyAs } from "../src/lib/sequences/rosterQuery";
import { openPostingSql } from "../src/lib/hiring/openPosting";

type Row = {
  person_country: string | null;
  company_country: string | null;
  posting_markets: string[] | null;
  phone: string | null;
  mobile_phone: string | null;
};

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Does either phone parse to a dial code at all? Splits "no phone" from "phone we cannot read". */
function phoneIsUsable(row: Row): boolean {
  for (const raw of [row.mobile_phone, row.phone]) {
    const value = clean(raw);
    if (!value) continue;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.isValid() && parsed.country) return true;
  }
  return false;
}

const bump = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
const sorted = (counts: Map<string, number>): [string, number][] => [...counts.entries()].sort((a, b) => b[1] - a[1]);

async function main() {
  const measuredAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const guard = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
    if (guard[0]?.transaction_read_only !== "on") throw new Error("read-only guard did not take; refusing to measure");

    // Live persons (a merged-away row is hidden from every read) with a non-blank email: the
    // population the create-sequence picker lists.
    const rows = (await tx.execute(sql`
      select p.country as person_country, p.phone, p.mobile_phone,
             ${companyCountrySql} as company_country,
             coalesce((select json_agg(distinct jp.market) from job_posting jp
                        where jp.is_it = true and ${openPostingSql("jp")} and ${sameCompanyAs("jp")}), '[]'::json) as posting_markets
        from person p
       where p.merged_into_id is null
         and nullif(btrim(p.email), '') is not null
    `)) as unknown as Row[];

    const mailableByLink = new Map<string, number>();
    const blockedByLink = new Map<string, number>();
    const blockedEvidence = new Map<string, number>();
    const noDataDetail = new Map<string, number>();

    let mailable = 0;
    let blocked = 0;

    for (const row of rows) {
      const out = explainComplianceAudience({
        mobilePhone: row.mobile_phone,
        phone: row.phone,
        personCountry: row.person_country,
        companyCountry: row.company_country,
        postingMarkets: row.posting_markets ?? [],
      });

      if (out.audience) {
        mailable += 1;
        bump(mailableByLink, `${out.reason ?? "(none)"} -> ${out.audience.address}/${out.audience.language}`);
        continue;
      }

      blocked += 1;
      // A null reason means no link had any data. A non-null one means a link DECIDED to hold:
      // text it could not name, or a sanctioned jurisdiction.
      bump(blockedByLink, out.reason ?? "(no link had any data)");
      if (out.reason !== null) {
        bump(blockedEvidence, `${out.reason}: ${out.evidence ?? "(no evidence)"}`);
      } else {
        const hasCountryText = Boolean(clean(row.person_country) || clean(row.company_country));
        bump(
          noDataDetail,
          hasCountryText
            ? "country text present but unnameable"
            : phoneIsUsable(row)
              ? "usable phone but it decided nothing"
              : clean(row.phone) || clean(row.mobile_phone)
                ? "phone present but unparseable, no country"
                : "no country and no phone at all",
        );
      }
    }

    console.log(`measured_at (UTC): ${measuredAt}`);
    console.log(`\nlive contacts with an email: ${rows.length}`);
    console.log(`  MAILABLE today:  ${mailable}`);
    console.log(`  BLOCKED today:   ${blocked}   (${((blocked / rows.length) * 100).toFixed(1)}%)`);

    console.log("\nmailable, by the link that decided:");
    for (const [key, n] of sorted(mailableByLink)) console.log(`  ${String(n).padStart(5)}  ${key}`);

    console.log("\nblocked, by the link that decided (or because none had data):");
    for (const [key, n] of sorted(blockedByLink)) console.log(`  ${String(n).padStart(5)}  ${key}`);

    console.log("\nblocked by a link that DID have data (unnameable text, or sanctioned):");
    const evidence = sorted(blockedEvidence);
    if (evidence.length === 0) console.log("  (none — the resolver names every country text present in the data)");
    for (const [key, n] of evidence.slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${key}`);

    console.log("\nblocked with no signal at all, broken down (what enrichment would have to supply):");
    for (const [key, n] of sorted(noDataDetail)) console.log(`  ${String(n).padStart(5)}  ${key}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
