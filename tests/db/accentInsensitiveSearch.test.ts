/**
 * DB-backed proof of the accent-insensitive search rule (src/lib/search/accentInsensitive.ts), against real Postgres
 * `unaccent`: (1) the SQL and the JS twin return the same verdict over the shared ACCENT_CASES, and (2) every search
 * surface that needs a live connection finds an accented row from an unaccented term and the reverse, and treats a
 * typed `%` or `_` as a literal. Needs migration 0046 (the `unaccent` extension) on the scratch database.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, DATABASE_URL pointing at a database whose name
 * ends in `_e2e`. Every row is created under a per-run token and removed afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const ck = `zz-${run}-acme`;
let bdId: string;
let personId: string;
let contactId: string;
let leadId: string;
let companyDisplay: string;

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, contact, lead, leadSource, person, targetCompany, jobPosting } = await import("@/db/schema");
  companyDisplay = `Peñalolén ${run}`;
  const [b] = await db.insert(bd).values({ name: "ZZ Accent", email: `zz-accent-${run}@example.test` }).returning();
  bdId = b.id;
  await db.insert(company).values({ companyKey: ck, displayName: companyDisplay, domain: `piñata-${run}.test` });
  await db.insert(companyAlias).values({ aliasKey: `zz-${run}-ñandú`, companyKey: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values({
    companyKey: ck, externalId: "1", title: "Engineer", location: "Miami, FL", url: "https://example.test", isIt: true, market: "us", isMiami: true,
  });
  const email = `zz-accent-${run}@example.test`;
  const [p] = await db
    .insert(person)
    .values({ firstName: "José", lastName: `Peña${run}`, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", company: null, companyKey: ck })
    .returning();
  personId = p.id;
  const [c] = await db
    .insert(contact)
    .values({ bdId, profileKey: `zz-${run}`, firstName: "José", lastName: `Peña${run}`, company: "Peñalolén SA", position: "Gerente Ejecutivo Núñez", industry: "Educación" })
    .returning();
  contactId = c.id;
  await db.insert(leadSource).values({ key: `zz-${run}`, displayName: "ZZ" });
  const [l] = await db
    .insert(lead)
    .values({ sourceKey: `zz-${run}`, attendeeId: run, firstName: "José", lastName: `Peña${run}`, companyDisplay: "Peñalolén SA", companyRaw: "Peñalolén Raw" })
    .returning();
  leadId = l.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, contact, jobPosting, lead, leadSource, person, targetCompany } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(lead).where(eq(lead.id, leadId));
  await db.delete(leadSource).where(eq(leadSource.key, `zz-${run}`));
  await db.delete(contact).where(eq(contact.id, contactId));
  await db.delete(person).where(eq(person.id, personId));
  await db.delete(jobPosting).where(eq(jobPosting.companyKey, ck));
  await db.delete(targetCompany).where(eq(targetCompany.companyKey, ck));
  await db.delete(companyAlias).where(eq(companyAlias.companyKey, ck));
  await db.delete(company).where(eq(company.companyKey, ck));
  await db.delete(bd).where(eq(bd.id, bdId));
});

test("SQL unaccent and the JS twin return the same verdict for every shared case", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { foldedIncludes, termContainsSql } = await import("@/lib/search/accentInsensitive");
  const { ACCENT_CASES } = await import("../fixtures/accentCases");
  for (const [text, term, expected] of ACCENT_CASES) {
    const rows = await db.execute(sql`select ${termContainsSql(sql`${text}::text`, term)} as m`);
    const verdict = (rows as unknown as Array<{ m: boolean }>)[0].m;
    assert.equal(verdict, expected, `SQL: ${text} / ${term}`);
    assert.equal(foldedIncludes(text, term), verdict, `JS twin disagrees with SQL: ${text} / ${term}`);
  }
});

test("a typed % or _ is a literal in SQL, never a wildcard", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { termContainsSql } = await import("@/lib/search/accentInsensitive");
  const m = async (text: string, term: string) =>
    ((await db.execute(sql`select ${termContainsSql(sql`${text}::text`, term)} as m`)) as unknown as Array<{ m: boolean }>)[0].m;
  assert.equal(await m("abc", "%"), false);
  assert.equal(await m("abc", "a_c"), false);
  assert.equal(await m("100% José", "100%"), true);
  assert.equal(await m("a_c", "a_c"), true);
});

/** Ids the condition returns from `table`, restricted to this run's row so other data in the database cannot interfere. */
async function hits(table: "person" | "contact" | "lead" | "company", condition: unknown) {
  const { db } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const s = await import("@/db/schema");
  const cond = condition as import("drizzle-orm").SQL;
  if (table === "person") return (await db.select({ id: s.person.id }).from(s.person).where(and(eq(s.person.id, personId), cond))).length;
  if (table === "contact") return (await db.select({ id: s.contact.id }).from(s.contact).where(and(eq(s.contact.id, contactId), cond))).length;
  if (table === "lead") return (await db.select({ id: s.lead.id }).from(s.lead).where(and(eq(s.lead.id, leadId), cond))).length;
  return (await db.select({ k: s.company.companyKey }).from(s.company).where(and(eq(s.company.companyKey, ck), cond))).length;
}

test("contacts list search (listQueries#searchCondition): name, company free text and canonical company name", async () => {
  const { searchCondition } = await import("@/lib/contacts/listQueries");
  const { companyNameMatchCondition } = await import("@/lib/contacts/companyNameCondition");
  assert.equal(await hits("person", searchCondition(`jose pena${run}`)), 1);
  assert.equal(await hits("person", searchCondition(`JOSÉ PEÑA${run}`)), 1);
  assert.equal(await hits("person", searchCondition(`penalolen ${run}`)), 1); // company_key -> canonical display name
  assert.equal(await hits("person", companyNameMatchCondition("PENALOLEN")), 1);
  assert.equal(await hits("person", searchCondition("%")), 0);
});

test("legacy contact search (queries#searchCondition): name, company, position and industry", async () => {
  const { searchCondition } = await import("@/lib/queries");
  assert.equal(await hits("contact", searchCondition(`jose pena${run}`)), 1);
  assert.equal(await hits("contact", searchCondition("nunez")), 1);
  assert.equal(await hits("contact", searchCondition("educacion")), 1);
  assert.equal(await hits("contact", searchCondition("_")), 0);
});

test("leads search: name and company (display and raw)", async () => {
  const { nameSearchCondition, leadCompanyCondition } = await import("@/lib/leads/queries");
  assert.equal(await hits("lead", nameSearchCondition(`jose pena${run}`)), 1);
  assert.equal(await hits("lead", leadCompanyCondition("penalolen")), 1);
  assert.equal(await hits("lead", leadCompanyCondition("PENALOLEN RAW")), 1);
  assert.equal(await hits("lead", leadCompanyCondition("%")), 0);
});

test("companies search: display name, domain and alias (companySearchCondition) and the legacy list (queries#searchCondition)", async () => {
  const { companySearchCondition } = await import("@/lib/companies/searchCondition");
  const { searchCondition } = await import("@/lib/companies/queries");
  assert.equal(await hits("company", companySearchCondition(`penalolen ${run}`)), 1);
  assert.equal(await hits("company", companySearchCondition(`PINATA-${run}`)), 1);
  assert.equal(await hits("company", companySearchCondition(`zz-${run}-nandu`)), 1); // company_alias.alias_key
  assert.equal(await hits("company", companySearchCondition("%")), 0);
  assert.equal(await hits("company", searchCondition(`peñalolen ${run}`)), 1);
});

test("task subject picker and the company picker find accented names from unaccented terms", async () => {
  const { searchTaskSubjects } = await import("@/lib/tasks/subjectSearchDb");
  const { searchContactCompanies } = await import("@/lib/contacts/companySearchDb");
  const subjects = await searchTaskSubjects(`pena`);
  assert.ok(subjects.some((s) => s.type === "person" && s.id === personId), "person by unaccented last name");
  const full = await searchTaskSubjects(`PENALOLEN ${run}`);
  assert.ok(full.some((s) => s.type === "company"), "company by unaccented display name");
  const companies = await searchContactCompanies(`penalolen ${run}`);
  assert.ok(companies.length >= 1);
});

test("outreach name filter and the Sequences roster picker fold accents", async () => {
  const { db } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const { outreachNameCondition } = await import("@/lib/outreach/queries");
  const { buildRosterCandidatesQuery } = await import("@/lib/sequences/rosterQuery");
  const named = await db.select({ id: person.id }).from(person).where(and(eq(person.id, personId), outreachNameCondition(`PENA${run}`)));
  assert.equal(named.length, 1);
  const roster = async (search: string) =>
    (await db.execute(buildRosterCandidatesQuery({ limit: 200, search }))) as unknown as Array<{ person_id: string }>;
  assert.ok((await roster(`pena`)).some((r) => r.person_id === personId), "roster finds Peña by 'pena'");
  assert.equal((await roster(`%${run}`)).length, 0, "a typed % is not a wildcard in the roster picker");
});
