/**
 * DB-backed pin of the industry filter: the chip counts and the list read ONE pool, and the industry resolves by the
 * company country's two paths (own row first, then the alias target). Opt-in and fail-closed: `npm run test:db`,
 * DATABASE_URL naming a `*_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const TECH = "Software de ordenador";
const VIA_ALIAS = "Internet";
const FIN = "Banca";
let bdId: string;
const personIds: Record<string, string> = {};
const companyKeys: string[] = [];

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Industry", email: `zz-industry-${run}@example.test` }).returning();
  bdId = b.id;
  const mk = async (name: string, over: { industry?: string | null; clientStatus?: string; aliasTo?: { industry: string | null } } = {}, email: { status?: string; country?: string | null } = {}) => {
    const k = key(name);
    companyKeys.push(k);
    await db.insert(company).values({ companyKey: k, displayName: `Co ${k}`, industry: over.industry ?? null, clientStatus: over.clientStatus ?? null });
    if (over.aliasTo) {
      const canonical = key(`${name}-canonical`);
      companyKeys.push(canonical);
      await db.insert(company).values({ companyKey: canonical, displayName: `Canon ${canonical}`, industry: over.aliasTo.industry });
      await db.insert(companyAlias).values({ aliasKey: k, companyKey: canonical });
    }
    const addr = `${key(name)}@example.test`;
    const [p] = await db.insert(person).values({ firstName: `Ind${run}`, lastName: name, email: addr, emailNormalized: addr, emailStatus: email.status ?? "verified", emailSource: "apollo", company: `Co ${k}`, companyKey: k, country: email.country === undefined ? "Argentina" : email.country }).returning();
    personIds[name] = p.id;
  };
  await mk("own", { industry: TECH });
  await mk("blank-own-alias", { industry: "   ", aliasTo: { industry: VIA_ALIAS } });
  await mk("own-wins-over-alias", { industry: FIN, aliasTo: { industry: VIA_ALIAS } });
  await mk("none");
  await mk("client", { industry: TECH, clientStatus: "active" });
  await mk("bounced", { industry: TECH }, { status: "bounced" });
  await mk("unknown-value", { industry: "Industry nobody mapped" });
  // No country anywhere, no postings, no phone: the compliance audience cannot be resolved, so blockedSql hides it from the default list.
  await mk("no-audience", { industry: TECH }, { country: null });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, Object.values(personIds)));
  await db.delete(companyAlias).where(inArray(companyAlias.aliasKey, companyKeys));
  await db.delete(company).where(inArray(company.companyKey, companyKeys));
  await db.delete(bd).where(inArray(bd.id, [bdId]));
});

const ids = async (over: Record<string, unknown>) => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const page = await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `Ind${run}`, ...over }, bdId, "?");
  return page.contacts.map((c) => c.personId).sort();
};
/** The chip counts exactly as the page action returns them: read WITH the page, from the same query. */
const counts = async (over: Record<string, unknown> = {}) => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const page = await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `Ind${run}`, ...over }, bdId, "?");
  assert.ok(page.industryCounts, "offset 0 returns counts");
  return page.industryCounts;
};
const named = (...n: string[]) => n.map((x) => personIds[x]).sort();

test("the counts are exactly the pool of the list: clients, bounced addresses and unresolvable audiences are in neither", async () => {
  const all = await ids({});
  assert.deepEqual(all, named("own", "blank-own-alias", "own-wins-over-alias", "none", "unknown-value"), "no-audience is hidden by blockedSql");
  assert.ok(!all.includes(personIds["no-audience"]));
  const c = await counts();
  assert.equal(c.total, all.length);
});

test("each count equals the list that chip would give, and the alias path resolves a blank own industry", async () => {
  const c = await counts();
  assert.equal(c.byValue[TECH], 1, "the no-audience Software contact is not counted");
  assert.equal(c.byValue[VIA_ALIAS], 1, "blank own row -> the alias target's industry");
  assert.equal(c.byValue[FIN], 1, "the own row wins over the alias target");
  assert.equal(c.none, 1);
  assert.equal(c.unmapped, 1);
  assert.deepEqual(await ids({ industries: [TECH] }), named("own"));
  assert.deepEqual(await ids({ industries: [VIA_ALIAS] }), named("blank-own-alias"));
  assert.deepEqual(await ids({ industries: [FIN] }), named("own-wins-over-alias"));
});

test("'no industry' selects the contacts without one and is not the same as no filter; unions with groups", async () => {
  assert.deepEqual(await ids({ noIndustry: true }), named("none"));
  assert.deepEqual(await ids({ noIndustry: true, industries: [TECH] }), named("own", "none"));
});

test("a selection never widens the pool: a client or bounced contact stays out under every industry choice", async () => {
  const { KNOWN_INDUSTRY_VALUES } = await import("@/lib/sequences/industryGroups");
  const got = await ids({ industries: [...KNOWN_INDUSTRY_VALUES], noIndustry: true });
  assert.ok(!got.includes(personIds.client) && !got.includes(personIds.bounced));
  assert.deepEqual(got, named("own", "blank-own-alias", "own-wins-over-alias", "none"));
});

test("with showBlocked the blocked-for-audience contact appears in the list AND in the counts", async () => {
  assert.ok((await ids({ showBlocked: true })).includes(personIds["no-audience"]));
  const c = await counts({ showBlocked: true });
  assert.equal(c.byValue[TECH], 4, "own + client + bounced + no-audience: showBlocked widens the list and the counts together");
  assert.equal(c.total, (await ids({ showBlocked: true })).length);
});

test("for every filter the page's counts total equals the size of the list returned with them (same call, same query)", async () => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  for (const over of [{}, { showBlocked: true }, { mine: true }, { florida: true }, { hiring: true }, { search: `Ind${run} none` }, { industries: [TECH] }, { noIndustry: true }]) {
    const page = await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `Ind${run}`, ...over }, bdId, "?");
    const lifted = "industries" in over || "noIndustry" in over;
    if (!lifted) assert.equal(page.industryCounts?.total, page.contacts.length, JSON.stringify(over));
    else assert.equal(page.industryCounts?.total, (await ids({})).length, "the industry selection narrows the list, never the counts");
  }
});

test("a 'Cargar más' page (offset > 0) returns no counts: the ones on screen still hold", async () => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  assert.equal((await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `Ind${run}`, offset: 50 }, bdId, "?")).industryCounts, null);
});
