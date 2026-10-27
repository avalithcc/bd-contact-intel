// READ-ONLY before/after of the market classifier's country-signal rewrite (src/lib/hiring/markets.ts, 2026-10-27).
// "Before" is the FROZEN old classifier (scripts/measure/legacyMarkets.ts, a verbatim copy of main at 76ddd9ba); "after" is the real
// classifyMarket, both imported, never re-implemented. Person impact goes through the application's own audience code
// (explainComplianceAudience, resolveDraftLanguage, the roster facts of pickerQuery.ts), so nothing here transcribes a rule.
//
// Prints counts and short LOCATION strings only: no person names, emails or ids.
// Usage: npx tsx --env-file=.env scripts/measure/market-country-signal.ts
import { sql } from "drizzle-orm";
import { db } from "../../src/db";
import { tokenize } from "../../src/lib/hiring/countryFilter";
import { classifyMarket as newMarket, isMiamiArea as newMiami } from "../../src/lib/hiring/markets";
import { openFreshPostingSql, openPostingSql } from "../../src/lib/hiring/openPosting";
import { audienceInputsFromRow } from "../../src/lib/sequences/audienceInputs";
import { explainComplianceAudience, type ComplianceAudience } from "../../src/lib/sequences/complianceAudience";
import { resolveDraftLanguage } from "../../src/lib/sequences/languageChoice";
import { distinctCountriesSql, rosterFacts } from "../../src/lib/sequences/pickerQuery";
import { companyCountrySql, postingMarketsSql, sameCompanyAs } from "../../src/lib/sequences/rosterQuery";
import { classifyMarket as oldMarket, isMiamiArea as oldMiami } from "./legacyMarkets";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Posting = { company_key: string; location: string; market: string | null; is_miami: boolean; is_it: boolean; is_open: boolean; is_fresh: boolean };
type Row = Record<string, unknown>;
type Tally = { rows: number; openIt: number; freshIt: number };

const SAMPLE_LIMIT = 40;
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sorted = <V>(m: Map<string, V>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
const tally = (): Tally => ({ rows: 0, openIt: 0, freshIt: 0 });
const add = (t: Tally, p: Posting) => {
  t.rows += 1;
  if (p.is_it && p.is_open) t.openIt += 1;
  if (p.is_it && p.is_fresh) t.freshIt += 1;
};
const show = (t: Tally) => `rows=${t.rows} openIT=${t.openIt} freshIT=${t.freshIt}`;
const label = (a: ComplianceAudience | null) => (a ? `${a.address}/${a.language}` : "HOLD");

async function readOnly(tx: Tx, when: string) {
  const r = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
  console.log(`transaction_read_only ${when}: ${r[0]?.transaction_read_only}`);
  if (r[0]?.transaction_read_only !== "on") throw new Error(`read-only guard is not on ${when}`);
}

function postingTables(postings: Posting[]) {
  const matrix = new Map<string, Tally>();
  const samples = new Map<string, Map<string, number>>();
  let storedDisagreesWithOld = 0;
  for (const p of postings) {
    const before = oldMarket(p.location);
    const after = newMarket(p.location);
    if (before !== p.market) storedDisagreesWithOld += 1;
    const key = `${before}>${after}`;
    const t = matrix.get(key) ?? tally();
    add(t, p);
    matrix.set(key, t);
    if (before !== after) {
      const bucket = samples.get(key) ?? new Map<string, number>();
      bump(bucket, p.location.trim());
      samples.set(key, bucket);
    }
  }
  console.log(`\n=== BASELINE: stored market != OLD classifier on ${storedDisagreesWithOld} of ${postings.length} rows (0 means the backfill was current)`);
  console.log(`\n=== market transition matrix, OLD -> NEW, over every job_posting row`);
  for (const [key, t] of sorted(matrix)) {
    const [a, b] = key.split(">");
    console.log(`  ${key}: ${show(t)}${a === b ? "" : "   <-- CHANGES"}`);
  }
  for (const [key, bucket] of sorted(samples)) {
    console.log(`\n--- distinct location strings that change ${key} (${bucket.size} distinct; top ${SAMPLE_LIMIT} by rows)`);
    for (const [loc, n] of [...bucket].sort((x, y) => y[1] - x[1]).slice(0, SAMPLE_LIMIT)) console.log(`  ${n} x ${loc}`);
  }
}

function isMiamiTables(postings: Posting[]) {
  const flips = new Map<string, Tally>();
  const examples: string[] = [];
  let storedDisagrees = 0;
  for (const p of postings) {
    const before = oldMiami(p.location);
    const after = newMiami(p.location);
    if (before !== p.is_miami) storedDisagrees += 1;
    if (before === after) continue;
    const t = flips.get(`${before}>${after}`) ?? tally();
    add(t, p);
    flips.set(`${before}>${after}`, t);
    if (examples.length < SAMPLE_LIMIT) examples.push(p.location.trim());
  }
  console.log(`\n=== is_miami: stored != old rule on ${storedDisagrees} rows; flips old -> new:`);
  if (!flips.size) console.log("  (none)");
  for (const [k, t] of sorted(flips)) console.log(`  ${k}: ${show(t)}`);
  for (const e of examples) console.log(`    ${e}`);
  const stray = postings.filter((p) => newMiami(p.location) && newMarket(p.location) !== "us");
  console.log(`  rows flagged Florida whose NEW market is not us (pre-existing, unchanged by this fix): ${stray.length}; distinct: ${[...new Set(stray.map((p) => p.location.trim()))].join(" | ") || "-"}`);
}

function tokenBuckets(postings: Posting[]) {
  const ca = new Map<string, Tally>();
  const tn = new Map<string, Tally>();
  const known = new Map<string, Tally>();
  const latamToOther = tally();
  for (const p of postings) {
    const tokens = new Set(tokenize(p.location));
    const before = oldMarket(p.location);
    const after = newMarket(p.location);
    if (tokens.has("ca")) {
      const text = p.location.trim();
      const countryForm = /^ca-/i.test(text) || (/,\s*ca\s*$/i.test(text) && text.split(",").length >= 3);
      const bucket = after === "us" ? "California (US)" : after === "latam" ? "latam" : countryForm ? "Canada (not US)" : "ambiguous (neither side)";
      const key = `${bucket} | old=${before} -> new=${after}`;
      const t = ca.get(key) ?? tally();
      add(t, p);
      ca.set(key, t);
    }
    if (tokens.has("tn")) {
      const key = `${after === "us" ? "Tennessee (US)" : "not US (Tamil Nadu / other)"} | old=${before} -> new=${after}`;
      const t = tn.get(key) ?? tally();
      add(t, p);
      tn.set(key, t);
    }
    if (before === "latam" && after === "us") {
      const which = ["co", "pa", "ar"].filter((c) => tokens.has(c)).join("+") || "no co/pa/ar (see samples: New Mexico etc.)";
      const t = known.get(which) ?? tally();
      add(t, p);
      known.set(which, t);
    }
    if (before === "latam" && after === "other") add(latamToOther, p);
  }
  console.log(`\n=== CA buckets (rows whose location has the token "ca")`);
  for (const [k, t] of sorted(ca)) console.log(`  ${k}: ${show(t)}`);
  console.log(`\n=== TN buckets (rows whose location has the token "tn")`);
  for (const [k, t] of sorted(tn)) console.log(`  ${k}: ${show(t)}`);
  console.log(`\n=== the known plainly-US rows filed latam, now us (by the bare code that used to win)`);
  for (const [k, t] of sorted(known)) console.log(`  ${k}: ${show(t)}`);
  console.log(`\n=== latam -> other (bare co/pa/ar with no place or country, or a foreign trailing country): ${show(latamToOther)}`);
}

async function companyChip(tx: Tx, postings: Posting[]) {
  const per = new Map<string, { hireOld: number; hireNew: number; usOld: boolean; usNew: boolean; latamOld: boolean; latamNew: boolean }>();
  for (const p of postings) {
    if (!p.is_it || !p.is_open) continue;
    const e = per.get(p.company_key) ?? { hireOld: 0, hireNew: 0, usOld: false, usNew: false, latamOld: false, latamNew: false };
    const before = oldMarket(p.location);
    const after = newMarket(p.location);
    if (p.is_fresh && before === "us") e.hireOld += 1;
    if (p.is_fresh && after === "us") e.hireNew += 1;
    if (before === "us") e.usOld = true;
    if (after === "us") e.usNew = true;
    if (before === "latam") e.latamOld = true;
    if (after === "latam") e.latamNew = true;
    per.set(p.company_key, e);
  }
  const persons = (await tx.execute(sql`select company_key, count(*)::int as n from person where merged_into_id is null and company_key is not null group by 1`)) as unknown as { company_key: string; n: number }[];
  const personsOf = new Map(persons.map((r) => [r.company_key, r.n]));
  const gain: string[] = [];
  const lose: string[] = [];
  let hireNow = 0;
  let hireAfter = 0;
  const bucketChange = new Map<string, number>();
  for (const [key, e] of per) {
    if (e.hireOld > 0) hireNow += 1;
    if (e.hireNew > 0) hireAfter += 1;
    if (e.hireOld === 0 && e.hireNew > 0) gain.push(key);
    if (e.hireOld > 0 && e.hireNew === 0) lose.push(key);
    const bucket = (us: boolean, latam: boolean) => (us && latam ? "mixed (HOLD)" : us ? "us" : latam ? "latam" : "none");
    const a = bucket(e.usOld, e.latamOld);
    const b = bucket(e.usNew, e.latamNew);
    if (a !== b) bump(bucketChange, `${a} -> ${b}`);
  }
  const sumPersons = (keys: string[]) => keys.reduce((s, k) => s + (personsOf.get(k) ?? 0), 0);
  console.log(`\n=== "With an open IT job in the US" chip (open fresh IT posting with market us; company_key as posted)`);
  console.log(`  companies with the chip: ${hireNow} -> ${hireAfter}`);
  console.log(`  GAIN the chip: ${gain.length} companies (${sumPersons(gain)} live persons at their own company_key)`);
  console.log(`  LOSE the chip: ${lose.length} companies (${sumPersons(lose)} live persons)`);
  console.log(`  gaining company keys: ${gain.join(", ") || "-"}`);
  console.log(`  losing company keys: ${lose.join(", ") || "-"}`);
  console.log(`  companies whose open-IT posting bucket (any freshness) changes: ${[...bucketChange.values()].reduce((a, b) => a + b, 0)}`);
  for (const [k, n] of sorted(bucketChange)) console.log(`    ${k}: ${n}`);
}

// Open IT postings of the company, aggregated ONCE per posting company_key (about 170 rows), then matched to each person with the
// application's own sameCompanyAs, instead of the per-person scan of job_posting that postingMarketsSql does.
const postingFacts = sql`pl as (
  select jp.company_key, json_agg(distinct jp.market) as markets, json_agg(distinct jp.location) as locs
  from job_posting jp where jp.is_it = true and ${openPostingSql("jp")} group by jp.company_key
)`;
const personFacts = sql`p.country as person_country, p.mobile_phone, p.phone, ${companyCountrySql} as company_country,
  coalesce((select json_agg(distinct m) from pl jp, json_array_elements_text(jp.markets) m where ${sameCompanyAs("jp")}), '[]'::json) as posting_markets,
  coalesce((select json_agg(distinct l) from pl jp, json_array_elements_text(jp.locs) l where ${sameCompanyAs("jp")}), '[]'::json) as posting_locations,
  coalesce(rs.roster, '[]'::json) as roster_countries`;
const rosterJoin = sql`left join company_alias ca on ca.alias_key = p.company_key left join pk_roster rs on rs.roster_key = coalesce(ca.company_key, p.company_key)`;

function audiencesOf(row: Row) {
  const inputs = audienceInputsFromRow(row);
  const locations = (row.posting_locations as string[] | null) ?? [];
  const newMarkets = [...new Set(locations.map((l) => newMarket(l)))];
  const oldMarkets = [...new Set(locations.map((l) => oldMarket(l)))];
  const before = explainComplianceAudience({ ...inputs, postingMarkets: oldMarkets });
  const after = explainComplianceAudience({ ...inputs, postingMarkets: newMarkets });
  return { inputs, before, after, storedMarkets: (row.posting_markets as string[] | null) ?? [], oldMarkets };
}

async function personImpact(tx: Tx) {
  const mailable = sql`(btrim(coalesce(p.email, '')) <> '' and p.email_status not in ('none', 'bounced') and (p.email_source is distinct from 'pattern_inferred' or p.email_status = 'verified')
    and not exists (select 1 from company c where c.client_status is not null and ${sameCompanyAs("c")})
    and not exists (select 1 from email_suppression s where (s.kind = 'address' and s.value = p.email_normalized) or (s.kind = 'domain' and s.value = split_part(p.email_normalized, '@', 2))))`;
  const started = Date.now();
  const rows = (await tx.execute(sql`
    with ${rosterFacts}, ${postingFacts}
    select p.id::text as person_id, ${personFacts}, ${mailable} as mailable
    from person p ${rosterJoin}
    where p.merged_into_id is null`)) as unknown as Row[];
  console.log(`\n=== PERSON impact: ${rows.length} live persons (mailable = has an email the picker would not hide), read in ${Date.now() - started} ms (one statement, set-based)`);
  console.log(`  mailable at contact level: ${rows.filter((r) => r.mailable).length}`);

  // Cross-check my set-based posting_markets against the application's own per-person fragment, on a sample.
  const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 300)) === 0).slice(0, 300);
  const byId = (await tx.execute(sql`select p.id::text as id, ${postingMarketsSql} as markets from person p where p.id in (${sql.join(sample.map((r) => sql`${r.person_id}::uuid`), sql`, `)})`)) as unknown as { id: string; markets: string[] }[];
  const mine = new Map(sample.map((r) => [String(r.person_id), JSON.stringify([...((r.posting_markets as string[]) ?? [])].sort())]));
  const disagree = byId.filter((b) => mine.get(b.id) !== JSON.stringify([...b.markets].sort())).length;
  console.log(`  cross-check vs postingMarketsSql on ${byId.length} persons: ${disagree} disagree (expected 0)`);

  const transitions = new Map<string, { n: number; mailable: number }>();
  let storedVsOld = 0;
  let changed = 0;
  let changedMailable = 0;
  let decidedByPostings = 0;
  const reasons = new Map<string, number>();
  let newlyHeld = 0;
  let unblocked = 0;
  for (const row of rows) {
    const a = audiencesOf(row);
    if (JSON.stringify([...a.storedMarkets].sort()) !== JSON.stringify([...a.oldMarkets].sort())) storedVsOld += 1;
    if (a.before.reason === "posting_markets" || a.after.reason === "posting_markets") decidedByPostings += 1;
    const x = label(a.before.audience);
    const y = label(a.after.audience);
    if (x === y) continue;
    changed += 1;
    if (row.mailable) changedMailable += 1;
    const t = transitions.get(`${x} -> ${y}`) ?? { n: 0, mailable: 0 };
    t.n += 1;
    if (row.mailable) t.mailable += 1;
    transitions.set(`${x} -> ${y}`, t);
    bump(reasons, `${a.before.reason ?? "none"} -> ${a.after.reason ?? "none"}`);
    if (y === "HOLD") newlyHeld += 1;
    if (x === "HOLD") unblocked += 1;
  }
  console.log(`  stored posting markets != old classifier for ${storedVsOld} persons (expected 0)`);
  console.log(`  persons whose audience is decided by the posting link in either world: ${decidedByPostings}`);
  console.log(`  persons whose AUDIENCE changes: ${changed}   of those mailable (contact-level): ${changedMailable}   newly HOLD: ${newlyHeld}   unblocked from HOLD: ${unblocked}`);
  for (const [k, t] of sorted(transitions)) console.log(`    ${k}: ${t.n} persons (${t.mailable} mailable)`);
  for (const [k, n] of sorted(reasons)) console.log(`    decided by ${k}: ${n}`);
}

async function sequenceImpact(tx: Tx) {
  const rows = (await tx.execute(sql`
    with ${rosterFacts}, ${postingFacts}
    select sm.id::text as member_id, sm.state, sm.draft_language, p.preferred_language, ${personFacts},
           (select count(*)::int from sequence_draft d where d.sequence_member_id = sm.id and d.approved_at is not null
              and ((d.step = 1 and sm.state in ('drafted', 'approved')) or (d.step = 2 and sm.state = 'sent'))) as approved_unsent,
           (select count(*)::int from sequence_draft d where d.sequence_member_id = sm.id
              and ((d.step = 1 and sm.state in ('drafted', 'approved')) or (d.step = 2 and sm.state = 'sent'))) as live_drafts
    from sequence_member sm
    join person p on p.id = sm.person_id
    ${rosterJoin}
    where sm.state in ('drafted', 'approved', 'sent')`)) as unknown as Row[];
  let audienceChanged = 0;
  let languageChanged = 0;
  let draftsOfChanged = 0;
  let approvedUnsentAffected = 0;
  const transitions = new Map<string, number>();
  for (const row of rows) {
    const a = audiencesOf(row);
    const x = label(a.before.audience);
    const y = label(a.after.audience);
    const lang = (aud: ComplianceAudience | null) =>
      resolveDraftLanguage(aud?.language ?? null, { chosen: row.draft_language as string | null, preferred: row.preferred_language as string | null })?.language ?? "none";
    if (x !== y) {
      audienceChanged += 1;
      draftsOfChanged += Number(row.live_drafts);
      approvedUnsentAffected += Number(row.approved_unsent);
      bump(transitions, `${row.state}: ${x} -> ${y}`);
    }
    if (lang(a.before.audience) !== lang(a.after.audience)) languageChanged += 1;
  }
  console.log(`\n=== LIVE SEQUENCE impact: ${rows.length} members in drafted/approved/sent`);
  console.log(`  members whose audience changes: ${audienceChanged}   whose final draft language changes (after chosen/preferred overrides): ${languageChanged}`);
  console.log(`  live drafts belonging to a member whose audience changes: ${draftsOfChanged}   of which approved-but-unsent: ${approvedUnsentAffected}`);
  for (const [k, n] of sorted(transitions)) console.log(`    ${k}: ${n}`);
}

async function countryStrings(tx: Tx) {
  const countries = ((await tx.execute(distinctCountriesSql)) as unknown as { country: string }[]).map((r) => r.country);
  const changes = countries.filter((c) => oldMarket(c) !== newMarket(c)).map((c) => `${c}: ${oldMarket(c)} -> ${newMarket(c)}`);
  console.log(`\n=== person/company COUNTRY strings (pickerQuery.countryFacts.us uses classifyMarket on these): ${countries.length} distinct, ${changes.length} change`);
  for (const c of changes) console.log(`  ${c}`);
}

async function main() {
  console.log(`measured_at (UTC): ${new Date().toISOString()}`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await readOnly(tx, "BEFORE reads");
    const postings = (await tx.execute(sql`
      select jp.company_key, jp.location, jp.market, jp.is_miami, jp.is_it, ${openPostingSql("jp")} as is_open, ${openFreshPostingSql("jp")} as is_fresh
      from job_posting jp`)) as unknown as Posting[];
    postingTables(postings);
    isMiamiTables(postings);
    tokenBuckets(postings);
    await companyChip(tx, postings);
    await personImpact(tx);
    await sequenceImpact(tx);
    await countryStrings(tx);
    await readOnly(tx, "AFTER reads");
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
