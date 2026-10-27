/**
 * DB-backed contract of the audience's roster link (complianceAudience.ts, rosterQuery.ts `rosterCountriesSql`, pickerQuery.ts
 * `pk_roster`). The pure rule is in tests/unit/sequencesRosterConsensus.test.ts; this pins what only real SQL can: the two
 * producers of the roster (by-id and set-based) return the same thing, the readers that consume it agree, and the picker never
 * hides a contact the roster would mail. Scratch database only: `npm run test:db` with DATABASE_URL naming a `*_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
let ownerId: string;
let accountId: string;
let sequenceId: string;
const personIds: string[] = [];
const companyKeys: string[] = [];
const ids = new Map<string, string>();

async function mkCompany(name: string, country: string | null) {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const ck = key(name);
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck, country });
  return ck;
}

async function mkPerson(name: string, ck: string | null, over: { country?: string | null; merged?: boolean; phone?: string } = {}) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const email = `${key(name)}@example.test`;
  const [p] = await db
    .insert(person)
    .values({ firstName: `ros-${name}`, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: ck, companyKey: ck, country: over.country ?? null, mobilePhone: over.phone ?? null })
    .returning();
  personIds.push(p.id);
  ids.set(name, p.id);
  if (over.merged) await db.execute(sql`update person set merged_into_id = ${personIds[0]}::uuid where id = ${p.id}::uuid`);
  return p;
}

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, emailAccount, sequence } = await import("@/db/schema");
  ownerId = (await db.insert(bd).values({ name: "ZZ roster", email: `zz-roster-${run}@example.test`, role: "bd" }).returning())[0].id;
  accountId = (await db.insert(emailAccount).values({ bdId: ownerId, emailAddress: `zz-roster-sender-${run}@example.test` }).returning())[0].id;
  sequenceId = (await db.insert(sequence).values({ name: key("seq"), ownerBdId: ownerId, emailAccountId: accountId, schedule: {} }).returning())[0].id;

  // Globant-like: filed "United States", its people in Argentina, one of them under an ALIAS key of the same company.
  const globant = await mkCompany("globant", "United States");
  const aliasKey = key("globant-alias");
  await db.insert(companyAlias).values({ aliasKey, companyKey: globant });
  await mkPerson("g-target", globant);
  await mkPerson("g-target-alias", aliasKey);
  await mkPerson("g-ar1", globant, { country: "Argentina" });
  await mkPerson("g-ar2", globant, { country: " Argentina " });
  await mkPerson("g-ar3", aliasKey, { country: "argentina" });
  await mkPerson("g-us", globant, { country: "USA" });
  await mkPerson("g-merged", globant, { country: "Argentina", merged: true });
  await mkPerson("g-blank", globant, { country: "   " });

  // Company filed with text that is not a country, three Argentine colleagues: used to HOLD, the roster rescues it.
  const miami = await mkCompany("miamifl", "Miami, FL");
  await mkPerson("m-target", miami);
  for (const n of [1, 2, 3]) await mkPerson(`m-ar${n}`, miami, { country: "Argentina" });

  // Colleagues split down the middle, company filed: no majority, the company is contradicted, nothing else answers.
  const nodo = await mkCompany("nodo", "United States");
  await mkPerson("n-target", nodo);
  for (const n of [1, 2]) await mkPerson(`n-ar${n}`, nodo, { country: "Argentina" });
  for (const n of [1, 2]) await mkPerson(`n-mx${n}`, nodo, { country: "Mexico" });

  void company;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray, eq } = await import("drizzle-orm");
  await db.delete(sequence).where(eq(sequence.ownerBdId, ownerId));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(companyAlias).where(inArray(companyAlias.companyKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(emailAccount).where(eq(emailAccount.bdId, ownerId));
  await db.delete(bd).where(eq(bd.id, ownerId));
});

const normalized = (roster: unknown) =>
  [...(roster as { country: string; n: number }[])].map((c) => `${c.country}:${Number(c.n)}`).sort();

test("the by-id roster and the picker's set-based roster are the same set for every person, alias keys included", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { rosterCountriesSql } = await import("@/lib/sequences/rosterQuery");
  const { buildPickerPageQuery } = await import("@/lib/sequences/pickerQuery");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const byId = (await db.execute(sql`select p.id::text as id, ${rosterCountriesSql} as roster from person p where p.id in (${sql.join(personIds.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as { id: string; roster: unknown }[];
  const picker = (await db.execute(buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, search: `ros- ${run}`, showBlocked: true }, ownerId, { unmapped: [], us: [] }))) as unknown as { person_id: string; roster_countries: unknown }[];
  const fromPicker = new Map(picker.map((r) => [r.person_id, normalized(r.roster_countries)]));
  assert.ok(fromPicker.size >= 10, "the picker page returned the fixtures");
  for (const r of byId) {
    if (!fromPicker.has(r.id)) continue; // merged contacts are not in the picker pool
    assert.deepEqual(fromPicker.get(r.id), normalized(r.roster), `person ${r.id}`);
  }
  const target = byId.find((r) => r.id === ids.get("g-target"))!;
  // Merged and blank colleagues are out; the alias-key colleague and the canonical ones pool into one company; spellings stay per filed text.
  assert.deepEqual(normalized(target.roster), ["USA:1", "argentina:1", "Argentina:2"].sort());
  const aliasTarget = byId.find((r) => r.id === ids.get("g-target-alias"))!;
  assert.deepEqual(normalized(aliasTarget.roster), normalized(target.roster), "a person filed under an alias key sees the same roster");
});

test("the detail card reads the roster: the colleagues' country, not the company's", async () => {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const [m] = await db.insert(sequenceMember).values({ sequenceId, personId: ids.get("g-target")!, state: "drafted" }).returning();
  const d = await getSequenceDetail({ id: ownerId, role: "bd" }, sequenceId);
  const a = d!.members.find((x) => x.memberId === m.id)!.audience!;
  assert.equal(a.reason, "roster_consensus");
  assert.deepEqual(a.audience, { address: "mdp", language: "es" });
  assert.deepEqual(a.colleagues, { agree: 3, of: 4 });
});

test("the add guard admits a contact only the roster can place, and refuses a split roster", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const added = await addMembersToSequence(ownerId, sequenceId, [ids.get("m-target")!, ids.get("n-target")!]);
  assert.ok(added.ok);
  assert.deepEqual(added.accepted, [ids.get("m-target")!]);
  assert.deepEqual(added.rejected, [{ personId: ids.get("n-target")!, reason: "unmapped_market" }]);
});

test("the picker agrees with the add guard: never hides what the roster mails, always badges what it holds", async () => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const visible = new Map((await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `ros- ${run}` }, ownerId, "-")).contacts.map((c) => [c.personId, c.block]));
  const everything = new Map((await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `ros- ${run}`, showBlocked: true }, ownerId, "-")).contacts.map((c) => [c.personId, c.block]));
  assert.equal(visible.get(ids.get("m-target")!), null, "rescued by the roster: visible and unblocked, though its company text is not a country");
  assert.equal(visible.get(ids.get("g-target")!), null);
  assert.equal(everything.get(ids.get("n-target")!), "unmappedMarket", "a split roster with nothing else holds, with its badge");
});

test("the unsubscribe page shows the address the email carried, from the same roster", async () => {
  const { sequenceMember } = await import("@/db/schema");
  const { db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { issueUnsubscribeToken, unsubscribeAudienceForToken } = await import("@/lib/sequences/unsubscribeQueries");
  const { hashUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const [m] = await db.select().from(sequenceMember).where(eq(sequenceMember.personId, ids.get("g-target")!));
  const token = await issueUnsubscribeToken({ sequenceMemberId: m.id, email: `${key("g-target")}@example.test` });
  const page = await unsubscribeAudienceForToken(hashUnsubscribeToken(token));
  assert.equal(page?.postalAddress, COMPLIANCE_CONFIG.mdp?.postalAddress);
  assert.equal(page?.locale, "es");
});
