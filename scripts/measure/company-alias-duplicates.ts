// Read-only: pairs of `company` rows that are probably ONE company with no company_alias between them, and the people who are
// duplicated across the two sides (the duplicates re-scan, #403, keys on name + company_key, so it cannot see these).
// Usage: npx tsx --env-file=.env scripts/measure/company-alias-duplicates.ts [--limit-weak=30]
// Prints company names, keys, domains, counts and the NAMES of cross-company same-name people. Never an email or a phone: the only
// address-derived value read is the domain part of a person's email, used as an identity signal for the company.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { isFreeMailDomain, isUnownableMailDomain } from "@/lib/emailPatterns";
import { normalizeNameKey } from "@/lib/leads/csv";
import { ownCompanyMatchReason } from "@/lib/ownCompany";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface CompanyRow {
  key: string;
  name: string;
  domain: string | null;
  linkedin: string | null;
  stage: string | null;
  accountType: string | null;
  clientStatus: string | null;
  owner: string | null;
}
interface PersonRow {
  id: string;
  first: string | null;
  last: string | null;
  company: string | null;
  companyKey: string | null;
  emailDomain: string | null;
  seqLive: number;
  acts: number;
}
interface Co extends CompanyRow {
  people: PersonRow[];
  dominantDomain: string | null;
  normName: string; // squashed name after dropping legal / generic tail tokens
  squash: string;
}
interface Pair {
  a: Co;
  b: Co;
  evidence: Set<string>;
  conflicts: Set<string>;
  sameName: { name: string; a: PersonRow; b: PersonRow }[];
}

// --- normalization -------------------------------------------------------------------------------------------------

const TAIL_TOKENS = new Set([
  "inc", "llc", "ltd", "sa", "srl", "sas", "corp", "corporation", "gmbh", "co", "company", "de", "cv", "spa", "sl", "ag", "plc", "pty",
  "tech", "technology", "technologies", "technologia", "tecnologia", "tecnologias", "group", "grupo", "holding", "holdings",
  "argentina", "arg", "latam", "latin", "america", "latinoamerica", "chile", "colombia", "mexico", "brasil", "brazil", "uruguay", "peru", "usa", "us",
]);

/** Lowercase, fold accents, punctuation to spaces, then drop legal / generic / country tokens from the END only ("tech mahindra" keeps "tech"). */
function nameTokens(name: string): string[] {
  const t = normalizeCompanyKey(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (t.length > 1 && TAIL_TOKENS.has(t[t.length - 1]!)) t.pop();
  return t;
}
const GEO_TOKENS = new Set(["argentina", "arg", "latam", "latin", "america", "latinoamerica", "chile", "colombia", "mexico", "brasil", "brazil", "uruguay", "peru", "usa", "us"]);
const DESC_TOKENS = new Set(["tech", "technology", "technologies", "technologia", "tecnologia", "tecnologias", "group", "grupo", "holding", "holdings"]);
function droppedDesc(name: string): string {
  const all = normalizeCompanyKey(name).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return all.slice(nameTokens(name).length).filter((x) => DESC_TOKENS.has(x)).sort().join("+");
}
/** The country / region words that were dropped from the end of the name: two sides that differ here are regional entities of one group. */
function droppedGeo(name: string): string {
  const all = normalizeCompanyKey(name).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const kept = nameTokens(name).length;
  return all.slice(kept).filter((x) => GEO_TOKENS.has(x)).sort().join("+");
}
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "andina.com.ar" -> "andina": the registrable label, tolerant of com.ar / co.uk style second-level suffixes. */
function domainStem(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const second = new Set(["com", "co", "net", "org", "gov", "edu"]);
  return parts.length >= 3 && second.has(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2]!;
}
const normLinkedin = (u: string | null): string | null => {
  const s = (u ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();
  return s || null;
};
const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// --- reads (4 round trips, all inside one read-only transaction) ----------------------------------------------------

async function readAll(tx: Tx) {
  const companies = (await tx.execute(sql`
    select c.company_key as key, c.display_name as name, c.domain, c.linkedin_url as linkedin, c.relationship_stage as stage,
      c.account_type as "accountType", c.client_status as "clientStatus", b.name as owner
    from company c left join bd b on b.id = c.owner_bd_id`)) as unknown as CompanyRow[];
  const aliases = (await tx.execute(sql`select alias_key as a, company_key as c from company_alias`)) as unknown as { a: string; c: string }[];
  const persons = (await tx.execute(sql`
    with pbc_seq as (select person_id, count(*)::int as pbc_n from sequence_member where state in ('drafted','approved','sent') group by person_id),
    pbc_act as (select person_id, count(*)::int as pbc_n from activity where person_id is not null and type <> 'status_backfill' group by person_id)
    select p.id::text as id, p.first_name as first, p.last_name as last, p.company, p.company_key as "companyKey",
      nullif(split_part(coalesce(p.email_normalized, ''), '@', 2), '') as "emailDomain",
      coalesce(s.pbc_n, 0) as "seqLive", coalesce(a.pbc_n, 0) as acts
    from person p left join pbc_seq s on s.person_id = p.id left join pbc_act a on a.person_id = p.id
    where p.merged_into_id is null and (p.company_key is not null or p.company is not null)`)) as unknown as (Omit<PersonRow, "seqLive" | "acts"> & { seqLive: number | string; acts: number | string })[];
  return {
    companies,
    aliases,
    persons: persons.map((p) => ({ ...p, seqLive: Number(p.seqLive), acts: Number(p.acts) })) as PersonRow[],
  };
}

// --- candidate generation ---------------------------------------------------------------------------------------------

function dominantDomain(people: readonly PersonRow[]): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of people) {
    const d = p.emailDomain?.toLowerCase();
    if (!d || isFreeMailDomain(d) || isUnownableMailDomain(d)) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    total += 1;
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
  // Support >= 2 people: one person's address (a consultant on a client's mailbox) is not what the company uses.
  return top && top[1] >= 2 && top[1] / total >= 0.5 ? top[0] : null;
}

type Class = "STRONG-ID" | "STRONG-DESC" | "STRONG-GEO" | "STRONG-DOMAIN" | "LIKELY" | "WEAK" | "FALSE";
const has = (pair: Pair, kind: string): boolean => [...pair.evidence].some((x) => x === kind || x.startsWith(`${kind}:`));

/**
 * STRONG-ID: a shared domain stem / LinkedIn URL, an exact normalized name that differs by no country word, or a shared people-email
 * domain together with a name that leads / contains the other. STRONG-GEO: the names are equal once country / region words are
 * dropped ("Hitss Argentina" vs "Hitss Peru"): one group, but regional entities, so a business decision. Conflicting domains or
 * LinkedIn URLs push anything weaker than that to FALSE.
 */
function classify(pair: Pair): Class {
  const affinity = has(pair, "exactName") || has(pair, "prefixWord") || has(pair, "prefixSquash") || has(pair, "tokenSubset");
  if (has(pair, "linkedin")) return "STRONG-ID";
  if (has(pair, "exactName")) {
    if (droppedGeo(pair.a.name) !== droppedGeo(pair.b.name)) return "STRONG-GEO";
    if (droppedDesc(pair.a.name) !== droppedDesc(pair.b.name)) return "STRONG-DESC";
    return "STRONG-ID";
  }
  if (has(pair, "domain") || has(pair, "domainStem")) return affinity ? "STRONG-ID" : "STRONG-DOMAIN";
  if (pair.conflicts.size > 0) return "FALSE";
  if (has(pair, "emailDomain") && affinity) return "STRONG-ID";
  return pair.sameName.length > 0 ? "LIKELY" : "WEAK";
}

const label = (c: Co): string =>
  `"${c.name}" [${c.key}] dom=${c.domain ?? "-"} li=${c.linkedin ? "y" : "-"} people=${c.people.length} stage=${c.stage ?? "-"} acct=${c.accountType ?? "-"} client=${c.clientStatus ?? "-"} owner=${c.owner ?? "-"}`;
const who = (p: PersonRow): string => `${p.seqLive > 0 ? "SEQ" : ""}${p.acts > 0 ? `act${p.acts}` : ""}` || "idle";

async function measure(tx: Tx, weakLimit: number) {
  await tx.execute(sql`set transaction read only`);
  const guard = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
  console.log(`transaction_read_only: ${guard[0]?.transaction_read_only}`);
  const { companies, aliases, persons } = await readAll(tx);

  const byKey = new Map<string, Co>();
  for (const c of companies) {
    const t = nameTokens(c.name);
    byKey.set(c.key, { ...c, people: [], dominantDomain: null, normName: squash(t.join("")), squash: squash(c.key) });
  }
  // Effective person company key: the same derivation the re-scan uses (stored key, else the normalized company text).
  for (const p of persons) {
    const key = p.companyKey ? p.companyKey : p.company ? normalizeCompanyKey(p.company) : null;
    const co = key ? byKey.get(key) : undefined;
    if (co) co.people.push(p);
  }
  for (const c of byKey.values()) c.dominantDomain = dominantDomain(c.people);
  const own = new Set([...byKey.values()].filter((c) => ownCompanyMatchReason(c.name, null) !== null || ownCompanyMatchReason(c.key, null) !== null).map((c) => c.key));
  const all = [...byKey.values()].filter((c) => !own.has(c.key) && c.squash.length >= 2).sort((x, y) => (x.key < y.key ? -1 : 1));
  const aliasPairs = new Set<string>();
  const aliasOf = new Map(aliases.map((r) => [r.a, r.c]));
  for (const c of all) {
    const to = aliasOf.get(c.key);
    if (to) aliasPairs.add(pairKey(c.key, to));
  }
  for (const [a, c] of aliasOf) for (const [a2, c2] of aliasOf) if (a < a2 && c === c2) aliasPairs.add(pairKey(a, a2));

  const pairs = new Map<string, Pair>();
  let aliasedSkipped = 0;
  const add = (a: Co, b: Co, ev: string) => {
    if (a.key === b.key) return;
    const k = pairKey(a.key, b.key);
    if (aliasPairs.has(k)) {
      aliasedSkipped += 1;
      return;
    }
    let p = pairs.get(k);
    if (!p) {
      const [x, y] = a.key < b.key ? [a, b] : [b, a];
      p = { a: x, b: y, evidence: new Set(), conflicts: new Set(), sameName: [] };
      pairs.set(k, p);
    }
    p.evidence.add(ev);
  };

  // Signal groups: equal value -> every pair inside the group.
  const group = (name: string, keyOf: (c: Co) => string | null, minLen = 1) => {
    const m = new Map<string, Co[]>();
    for (const c of all) {
      const v = keyOf(c);
      if (v && v.length >= minLen) (m.get(v) ?? m.set(v, []).get(v)!).push(c);
    }
    for (const [v, g] of m) {
      if (g.length < 2 || g.length > 8) continue; // a value shared by 9+ rows is a generic token, not an identity
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) add(g[i]!, g[j]!, `${name}:${v}`);
    }
  };
  group("domain", (c) => c.domain?.toLowerCase() ?? null);
  group("domainStem", (c) => (c.domain && !isFreeMailDomain(c.domain) ? domainStem(c.domain) : null), 3);
  group("linkedin", (c) => normLinkedin(c.linkedin));
  group("exactName", (c) => c.normName, 3);
  group("emailDomain", (c) => c.dominantDomain);
  // A company's stored domain against another company's dominant people domain.
  const byDomain = new Map(all.filter((c) => c.domain).map((c) => [c.domain!.toLowerCase(), c]));
  for (const c of all) {
    const hit = c.dominantDomain ? byDomain.get(c.dominantDomain) : undefined;
    if (hit && hit.key !== c.key) add(c, hit, `emailDomain:${c.dominantDomain}`);
  }

  // Prefix signals. Words: all of A's name tokens lead B's tokens. Squash: sorted adjacency, shorter side >= 4 chars.
  const byTokens = new Map<string, Co[]>();
  for (const c of all) {
    const joined = nameTokens(c.name).join(" ");
    byTokens.set(joined, [...(byTokens.get(joined) ?? []), c]);
  }
  for (const c of all) {
    const t = nameTokens(c.name);
    for (let n = 1; n < t.length; n++) for (const hit of byTokens.get(t.slice(0, n).join(" ")) ?? []) add(hit, c, "prefixWord");
  }
  // Token subset: every word of the shorter name appears in the longer one ("banco supervielle" contains "supervielle").
  const tokenSets = new Map(all.map((c) => [c.key, new Set(nameTokens(c.name))]));
  const byWord = new Map<string, Co[]>();
  for (const c of all) for (const w of tokenSets.get(c.key)!) if (w.length >= 5) byWord.set(w, [...(byWord.get(w) ?? []), c]);
  for (const g of byWord.values()) {
    if (g.length > 12) continue;
    for (const x of g) for (const y of g) {
      const sx = tokenSets.get(x.key)!;
      const sy = tokenSets.get(y.key)!;
      if (x.key < y.key && sx.size !== sy.size && [...(sx.size < sy.size ? sx : sy)].every((w) => (sx.size < sy.size ? sy : sx).has(w))) add(x, y, "tokenSubset");
    }
  }
  const sorted = [...all].sort((x, y) => (x.squash < y.squash ? -1 : x.squash > y.squash ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.squash.length < 4) continue;
    for (let j = i + 1; j < sorted.length && sorted[j]!.squash.startsWith(s.squash); j++) {
      if (sorted[j]!.squash !== s.squash) add(s, sorted[j]!, "prefixSquash");
    }
  }

  // Conflicts: identity evidence that says "different companies".
  for (const p of pairs.values()) {
    const { a, b } = p;
    if (a.domain && b.domain && domainStem(a.domain) !== domainStem(b.domain)) p.conflicts.add("domains differ");
    const la = normLinkedin(a.linkedin);
    const lb = normLinkedin(b.linkedin);
    if (la && lb && la !== lb) p.conflicts.add("linkedin differs");
    if (a.dominantDomain && b.dominantDomain && domainStem(a.dominantDomain) !== domainStem(b.dominantDomain)) p.conflicts.add("people email domains differ");
  }

  // Cross-company same-name people (>= 2 name tokens), counted only for candidate pairs.
  const byName = new Map<string, { co: Co; p: PersonRow }[]>();
  for (const c of all) {
    for (const p of c.people) {
      const nm = normalizeNameKey(`${p.first ?? ""} ${p.last ?? ""}`);
      if (nm.split(" ").length < 2) continue;
      (byName.get(nm) ?? byName.set(nm, []).get(nm)!).push({ co: c, p });
    }
  }
  let crossNameGroups = 0;
  let crossNameCovered = 0;
  for (const [nm, list] of byName) {
    const distinct = new Set(list.map((x) => x.co.key));
    if (distinct.size < 2) continue;
    crossNameGroups += 1;
    let covered = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i]!.co.key === list[j]!.co.key) continue;
        const pr = pairs.get(pairKey(list[i]!.co.key, list[j]!.co.key));
        if (!pr) continue;
        covered = true;
        const [x, y] = list[i]!.co.key === pr.a.key ? [list[i]!, list[j]!] : [list[j]!, list[i]!];
        pr.sameName.push({ name: nm, a: x.p, b: y.p });
      }
    }
    if (covered) crossNameCovered += 1;
  }

  const classes: Record<Class, Pair[]> = { "STRONG-ID": [], "STRONG-DESC": [], "STRONG-GEO": [], "STRONG-DOMAIN": [], LIKELY: [], WEAK: [], FALSE: [] };
  for (const p of pairs.values()) classes[classify(p)]!.push(p);
  const rank = (p: Pair) => p.sameName.length * 1000 + p.a.people.length + p.b.people.length;
  for (const k of Object.keys(classes) as Class[]) classes[k].sort((x, y) => rank(y) - rank(x) || (x.a.key < y.a.key ? -1 : 1));

  console.log(`companies=${companies.length} considered=${all.length} ownCompanyExcluded=${own.size} aliasRows=${aliases.length} livePersons=${persons.length}`);
  console.log(`candidate pairs=${pairs.size} (pairs already joined by an alias skipped: ${aliasedSkipped})`);
  for (const k of Object.keys(classes) as Class[]) {
    const list = classes[k];
    const people = list.reduce((n, p) => n + p.sameName.length, 0);
    console.log(`${k}: ${list.length} pairs, ${people} cross-company same-name person pairs, ${list.filter((p) => p.sameName.some((s) => s.a.seqLive > 0 || s.b.seqLive > 0)).length} pairs with a same-name person in a live sequence`);
  }
  const evCount = new Map<string, number>();
  for (const p of classes["STRONG-ID"]) for (const e of new Set([...p.evidence].map((x) => x.split(":")[0]!))) evCount.set(e, (evCount.get(e) ?? 0) + 1);
  console.log(`STRONG-ID by evidence kind (a pair can carry several): ${[...evCount].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`STRONG-ID with a conflict flag: ${classes["STRONG-ID"].filter((p) => p.conflicts.size > 0).length}`);
  console.log(`Cross-company same-name groups overall: ${crossNameGroups}; covered by a candidate pair: ${crossNameCovered}; not covered (people who changed employer, namesakes): ${crossNameGroups - crossNameCovered}`);

  // What the re-scan would find after the merges: union the companies of the chosen classes, then count person groups (same name key)
  // that span 2+ ORIGINAL companies inside one cluster. Each such group is a pair-or-more of duplicate_candidate rows to create.
  const simulate = (kinds: Class[], minTokens: number) => {
    const parent = new Map<string, string>();
    const find = (x: string): string => (parent.get(x) === undefined || parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
    const members = new Set<string>();
    for (const k of kinds) for (const p of classes[k]) {
      parent.set(find(p.a.key), find(p.b.key));
      members.add(p.a.key);
      members.add(p.b.key);
    }
    const groups = new Map<string, Set<string>>();
    const sizes = new Map<string, number>();
    for (const c of all) {
      const root = find(c.key);
      if (!members.has(c.key)) continue;
      for (const p of c.people) {
        const nm = normalizeNameKey(`${p.first ?? ""} ${p.last ?? ""}`);
        if (!nm || nm.split(" ").length < minTokens) continue;
        const g = `${root}\u0000${nm}`;
        (groups.get(g) ?? groups.set(g, new Set()).get(g)!).add(c.key);
        sizes.set(g, (sizes.get(g) ?? 0) + 1);
      }
    }
    const spanning = [...groups].filter(([, ks]) => ks.size >= 2);
    const clusters = new Set([...members].map(find)).size;
    return { clusters, groups: spanning.length, persons: spanning.reduce((n, [g]) => n + sizes.get(g)!, 0) };
  };
  const scenarios: [string, Class[]][] = [
    ["ID", ["STRONG-ID"]],
    ["ID+DESC", ["STRONG-ID", "STRONG-DESC"]],
    ["ID+DESC+DOMAIN", ["STRONG-ID", "STRONG-DESC", "STRONG-DOMAIN"]],
    ["ID+DESC+LIKELY", ["STRONG-ID", "STRONG-DESC", "LIKELY"]],
    ["ID+DESC+GEO", ["STRONG-ID", "STRONG-DESC", "STRONG-GEO"]],
    ["ALL STRONG+LIKELY", ["STRONG-ID", "STRONG-DESC", "STRONG-GEO", "STRONG-DOMAIN", "LIKELY"]],
  ];
  for (const [name, kinds] of scenarios) {
    const a = simulate(kinds, 2);
    const b = simulate(kinds, 1);
    console.log(`scenario ${name}: clusters=${a.clusters} person groups spanning 2+ companies (2+ name tokens)=${a.groups} (${a.persons} persons); any-name rule (what the re-scan uses)=${b.groups} (${b.persons} persons)`);
  }
  console.log(`sanity: persons in a live sequence=${persons.filter((p) => p.seqLive > 0).length} persons with real activity=${persons.filter((p) => p.acts > 0).length} numeric-only company keys=${all.filter((c) => /^[0-9]+$/.test(c.key)).length} own-company rows excluded=${own.size}`);

  // Blind spots of the re-scan beyond unmerged companies: persons it keys by something other than a live company row.
  const aliasKeys = new Set(aliases.map((a) => a.a));
  const noKey = persons.filter((p) => !p.companyKey && p.company);
  const orphan = persons.filter((p) => p.companyKey && !byKey.has(p.companyKey));
  console.log(`persons with company text but NULL company_key=${noKey.length} (their normalized text matches a company row: ${noKey.filter((p) => byKey.has(normalizeCompanyKey(p.company!))).length}); persons whose company_key matches no company row=${orphan.length}; persons still keyed by an alias_key=${persons.filter((p) => p.companyKey && aliasKeys.has(p.companyKey)).length}`);

  const show = (p: Pair) => {
    console.log(`- ${label(p.a)}\n  <-> ${label(p.b)}`);
    console.log(`  evidence: ${[...p.evidence].join(", ")}${p.conflicts.size ? ` | CONFLICT: ${[...p.conflicts].join(", ")}` : ""}`);
    if (p.sameName.length) console.log(`  same-name people (${p.sameName.length}): ${p.sameName.map((s) => `${s.name} [${who(s.a)} | ${who(s.b)}]`).join("; ")}`);
  };
  for (const k of ["STRONG-ID", "STRONG-DESC", "STRONG-DOMAIN", "STRONG-GEO", "LIKELY"] as const) {
    console.log(`\n===== ${k} (${classes[k].length}) =====`);
    for (const p of classes[k]) show(p);
  }
  const step = Math.max(1, Math.floor(classes.WEAK.length / weakLimit));
  console.log(`\n===== WEAK sample (every ${step}th of ${classes.WEAK.length}) =====`);
  classes.WEAK.filter((_, i) => i % step === 0).slice(0, weakLimit).forEach(show);
  const falseSame = classes.FALSE.filter((p) => p.sameName.length > 0);
  console.log(`\n===== FALSE with same-name people (${falseSame.length} of ${classes.FALSE.length}) =====`);
  falseSame.forEach(show);
  console.log(`\n===== FALSE sample (every ${Math.max(1, Math.floor(classes.FALSE.length / 15))}th) =====`);
  classes.FALSE.filter((_, i) => i % Math.max(1, Math.floor(classes.FALSE.length / 15)) === 0).slice(0, 15).forEach(show);

  const after = (await tx.execute(sql`show transaction_read_only`)) as unknown as { transaction_read_only: string }[];
  console.log(`\ntransaction_read_only (after): ${after[0]?.transaction_read_only}`);
}

async function main() {
  const weak = Number(process.argv.find((a) => a.startsWith("--limit-weak="))?.split("=")[1] ?? 30);
  await db.transaction(async (tx) => {
    await measure(tx, Number.isFinite(weak) && weak > 0 ? weak : 30);
  });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
