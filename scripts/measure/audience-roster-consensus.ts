/**
 * READ-ONLY measurement of the roster-consensus change to the compliance audience (complianceAudience.ts, 2026-10-27).
 *
 * "Today" is the new resolver fed an EMPTY roster: with no colleagues it reduces to the old chain exactly (no majority, no
 * contradiction), a property the unit tests pin. "After" is the same resolver fed the roster the application's own SQL produces
 * (`audienceFactsSql`, imported, not transcribed). So the difference printed here is the roster link and nothing else.
 *
 * Prints, for the live emailable contacts (the picker's pool): how many change audience, the transition matrix, the newly held
 * and unblocked, the companies behind the flips, and a leave-one-out check of the draft language (hide a contact's own country,
 * predict it, compare). Then the query plans/timings of the roster reads against this database.
 *
 * The population is read with the picker's own set-based roster (`rosterFacts`, one grouped pass), because the by-id fragment
 * (`audienceFactsSql`) is a correlated subquery per row and is built for a handful of ids, not 7,500 (a bulk read of it hits
 * the database's statement timeout, measured). The two producers are cross-checked on a sample below.
 *
 * Nothing is written. `set transaction read only` is asserted before AND after the reads.
 *
 * Usage (reads the real database; SELECT only):
 *   npx tsx --env-file=.env scripts/measure/audience-roster-consensus.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../../src/db";
import { audienceInputsFromRow } from "../../src/lib/sequences/audienceInputs";
import { explainComplianceAudience, resolveCountry, rosterBreakdown, type ColleagueCountry, type ComplianceAudience, type ComplianceAudienceInputs } from "../../src/lib/sequences/complianceAudience";
import { buildPickerPageQuery, countryFacts, distinctCountriesSql, rosterFacts } from "../../src/lib/sequences/pickerQuery";
import { DEFAULT_PICKER_QUERY } from "../../src/lib/sequences/pickerFilters";
import { audienceFactsSql, canonicalCompanyJoinSql, companyCountrySql, postingMarketsSql, rosterCountriesSql } from "../../src/lib/sequences/rosterQuery";

type Row = Record<string, unknown> & { person_id: string; company: string | null; has_email: boolean };

const label = (a: ComplianceAudience | null) => (a ? `${a.address}/${a.language}` : "HOLD");
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

async function readOnlyFlag(tx: { execute: typeof db.execute }, when: string) {
  const r = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
  console.log(`transaction_read_only ${when}: ${r[0]?.transaction_read_only}`);
  if (r[0]?.transaction_read_only !== "on") throw new Error(`read-only guard not on ${when}; refusing to continue`);
}

function summarize(title: string, rows: { row: Row; before: ReturnType<typeof explainComplianceAudience>; after: ReturnType<typeof explainComplianceAudience> }[]) {
  const transitions = new Map<string, number>();
  const flipCompanies = new Map<string, number>();
  const holdCompanies = new Map<string, number>();
  const unblockedCompanies = new Map<string, number>();
  const reasons = new Map<string, number>();
  let changed = 0, newHold = 0, unblocked = 0, disagree = 0;
  for (const { row, before, after } of rows) {
    bump(reasons, after.reason ?? "(no link had data)");
    if (after.colleaguesDisagree) disagree += 1;
    const a = label(before.audience), b = label(after.audience);
    if (a === b) continue;
    changed += 1;
    bump(transitions, `${a} -> ${b}`);
    const shape = `${row.company ?? "(no company)"} [filed: ${String(row.company_country ?? "-")}] colleagues: ${rosterBreakdown(row.roster_countries as ColleagueCountry[]).map((c) => `${c.iso} ${c.n}`).join(", ") || "-"}`;
    if (b === "HOLD") { newHold += 1; bump(holdCompanies, `${a} -> HOLD | ${shape}`); }
    if (a === "HOLD") { unblocked += 1; bump(unblockedCompanies, `${shape} => ${label(after.audience)}`); }
    if (b === "mdp/es" && a.startsWith("miami/")) bump(flipCompanies, `${a} | ${row.company ?? "(no company)"}`);
  }
  console.log(`\n=== ${title}: ${rows.length} contacts ===`);
  console.log(`audience CHANGED: ${changed}   newly HOLD: ${newHold}   unblocked (HOLD -> mailable): ${unblocked}   colleagues disagree: ${disagree}`);
  console.log(`transitions:`);
  for (const [k, c] of sorted(transitions)) console.log(`  ${k}: ${c}`);
  console.log(`decided by (after):`);
  for (const [k, c] of sorted(reasons)) console.log(`  ${k}: ${c}`);
  console.log(`newly HOLD by company (top 15):`);
  for (const [k, c] of sorted(holdCompanies).slice(0, 15)) console.log(`  ${c} x ${k}`);
  console.log(`unblocked by company (top 8):`);
  for (const [k, c] of sorted(unblockedCompanies).slice(0, 8)) console.log(`  ${c} x ${k}`);
  console.log(`miami/* -> mdp/es by company (top 25):`);
  for (const [k, c] of sorted(flipCompanies).slice(0, 25)) console.log(`  ${k}: ${c}`);
}

/** Hide the contact's own country and predict it; compare the predicted language/address with the truth. */
function leaveOneOut(rows: Row[]) {
  const stat = (name: string) => ({ name, n: 0, held: 0, wrongLang: 0, wrongAddr: 0 });
  const oldS = stat("old chain (company, postings, phone)"), newS = stat("new chain (roster majority, company, postings, phone)");
  for (const row of rows) {
    const full = audienceInputsFromRow(row);
    const own = full.personCountry?.trim();
    const truthIso = own ? resolveCountry(own) : null;
    if (!own || !truthIso) continue;
    const truth = explainComplianceAudience({ ...full, rosterCountries: [] }).audience;
    if (!truth) continue; // a sanctioned truth holds whatever we predict
    // Remove THIS contact from its own roster (the SQL roster includes everyone with a country, the contact too).
    let removed = false;
    const others: ColleagueCountry[] = full.rosterCountries.map((c) => {
      if (!removed && c.country === own) { removed = true; return { country: c.country, n: c.n - 1 }; }
      return c;
    });
    const hidden: ComplianceAudienceInputs = { ...full, personCountry: null };
    for (const [s, roster] of [[oldS, []], [newS, others]] as const) {
      s.n += 1;
      const predicted = explainComplianceAudience({ ...hidden, rosterCountries: roster }).audience;
      if (!predicted) { s.held += 1; continue; }
      if (predicted.language !== truth.language) s.wrongLang += 1;
      if (predicted.address !== truth.address) s.wrongAddr += 1;
    }
  }
  console.log(`\n=== leave-one-out over live contacts with a recognized, mailable own country ===`);
  for (const s of [oldS, newS]) {
    const answered = s.n - s.held;
    console.log(`${s.name}: n=${s.n} held=${s.held} (${pct(s.held, s.n)}) wrong language=${s.wrongLang}/${answered} (${pct(s.wrongLang, answered)}) wrong address=${s.wrongAddr}/${answered} (${pct(s.wrongAddr, answered)})`);
  }
}

async function plan(tx: { execute: typeof db.execute }, title: string, query: ReturnType<typeof sql>) {
  const runs: number[] = [];
  let text: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const out = (await tx.execute(sql`explain (analyze, buffers) ${query}`)) as unknown as { "QUERY PLAN": string }[];
    text = out.map((r) => r["QUERY PLAN"]);
    runs.push(Number(/Execution Time: ([\d.]+) ms/.exec(text.join("\n"))?.[1] ?? Number.NaN));
  }
  console.log(`\n--- ${title}: execution ms over 3 runs = ${runs.map((r) => r.toFixed(1)).join(", ")}`);
  for (const line of text.filter((l) => /Planning Time|Execution Time|CTE pk_roster|SubPlan|Seq Scan on person|Index.*person_company_key/.test(l)).slice(0, 8)) console.log(`    ${line.trim()}`);
}

async function main() {
  console.log(`measured_at (UTC): ${new Date().toISOString()}`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await readOnlyFlag(tx, "BEFORE reads");

    const started = Date.now();
    const rows = (await tx.execute(sql`
      with ${rosterFacts}
      select p.id::text as person_id, coalesce(p.company, cn.display_name) as company, true as has_email,
             p.country as person_country, p.mobile_phone, p.phone, ${companyCountrySql} as company_country, ${postingMarketsSql} as posting_markets,
             coalesce(rs.roster, '[]'::json) as roster_countries
      from person p
      ${canonicalCompanyJoinSql}
      left join company_alias ca on ca.alias_key = p.company_key
      left join pk_roster rs on rs.roster_key = coalesce(ca.company_key, p.company_key)
      where p.merged_into_id is null and btrim(coalesce(p.email, '')) <> ''`)) as unknown as Row[];
    console.log(`read ${rows.length} live emailable contacts in ${Date.now() - started} ms (one statement, set-based roster)`);

    // The two roster producers must agree on production data, not only on fixtures: compare a sample of 300 contacts.
    const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 300)) === 0).slice(0, 300);
    const byId = (await tx.execute(sql`select p.id::text as id, ${rosterCountriesSql} as roster from person p where p.id in (${sql.join(sample.map((r) => sql`${r.person_id}::uuid`), sql`, `)})`)) as unknown as { id: string; roster: ColleagueCountry[] }[];
    const norm = (r: ColleagueCountry[]) => JSON.stringify(r.map((c) => `${c.country}:${Number(c.n)}`).sort());
    const setBased = new Map(sample.map((r) => [r.person_id, norm(r.roster_countries as ColleagueCountry[])]));
    const disagreeing = byId.filter((b) => setBased.get(b.id) !== norm(b.roster)).length;
    console.log(`roster producers cross-check: ${byId.length} sampled contacts, ${disagreeing} where by-id and set-based rosters differ (expected 0)`);

    const evaluated = rows.map((row) => {
      const inputs = audienceInputsFromRow(row);
      return { row, before: explainComplianceAudience({ ...inputs, rosterCountries: [] }), after: explainComplianceAudience(inputs) };
    });
    summarize("live contacts WITH an email (the picker's pool)", evaluated);
    leaveOneOut(rows);

    // Aliases that chain (an alias key that is itself an alias target) would make the by-id and set-based rosters differ.
    const chained = (await tx.execute(sql`select count(*)::int as n from company_alias a join company_alias b on b.alias_key = a.company_key and b.company_key <> a.company_key`)) as unknown as { n: number }[];
    console.log(`\nchained company aliases (should be 0 for the two roster producers to agree): ${chained[0]?.n}`);

    // Plans: the largest company's contact (worst case of the by-id roster), a 100-person bulk read, and the picker page.
    const big = (await tx.execute(sql`select p.id::text as id from person p where p.merged_into_id is null and p.company_key is not null group by p.id, p.company_key order by (select count(*) from person q where q.company_key = p.company_key) desc limit 1`)) as unknown as { id: string }[];
    const bulk = (await tx.execute(sql`select p.id::text as id from person p where p.merged_into_id is null and p.company_key is not null order by (select count(*) from person q where q.company_key = p.company_key) desc limit 100`)) as unknown as { id: string }[];
    await plan(tx, "by-id audience read, contact of the LARGEST company", sql`select ${audienceFactsSql} from person p where p.id = ${big[0].id}::uuid`);
    await plan(tx, "bulk audience read, 100 contacts of the largest companies (approval/detail shape)", sql`select p.id, ${audienceFactsSql} from person p where p.id in (${sql.join(bulk.map((b) => sql`${b.id}::uuid`), sql`, `)})`);
    const facts = countryFacts(((await tx.execute(distinctCountriesSql)) as unknown as { country: string }[]).map((r) => r.country));
    await plan(tx, "picker page (default view, offset 0)", buildPickerPageQuery(DEFAULT_PICKER_QUERY, "00000000-0000-0000-0000-000000000000", facts));
    await plan(tx, "picker page (showBlocked)", buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, showBlocked: true }, "00000000-0000-0000-0000-000000000000", facts));

    await readOnlyFlag(tx, "AFTER reads");
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
