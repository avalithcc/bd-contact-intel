/**
 * DB-backed pin of the country filter and of the one-pass counts: the country is the EFFECTIVE one (the person's own first,
 * then the company's own row, then its alias target), each marginal has its own selection lifted and the other applied, and
 * the checkbox signals are counted under both. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL naming a `*_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const key = (name: string) => `zz-${run}-${name}`;
const TECH = "Software de ordenador";
const FIN = "Banca";
let bdId: string;
const personIds: Record<string, string> = {};
const companyKeys: string[] = [];

type Spec = { personCountry?: string | null; companyCountry?: string | null; aliasCountry?: string; industry: string; phone?: string; city?: string; region?: string };

before(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Country", email: `zz-country-${run}@example.test` }).returning();
  bdId = b.id;
  const mk = async (name: string, s: Spec) => {
    const k = key(name);
    companyKeys.push(k);
    await db.insert(company).values({ companyKey: k, displayName: `Co ${k}`, industry: s.industry, country: s.companyCountry ?? null });
    if (s.aliasCountry) {
      const canonical = key(`${name}-canonical`);
      companyKeys.push(canonical);
      await db.insert(company).values({ companyKey: canonical, displayName: `Canon ${canonical}`, country: s.aliasCountry });
      await db.insert(companyAlias).values({ aliasKey: k, companyKey: canonical });
    }
    const addr = `${k}@example.test`;
    const [p] = await db.insert(person).values({ firstName: `Cty${run}`, lastName: name, email: addr, emailNormalized: addr, emailStatus: "verified", emailSource: "apollo", company: `Co ${k}`, companyKey: k, country: s.personCountry ?? null, mobilePhone: s.phone ?? null, city: s.city ?? null, region: s.region ?? null }).returning();
    personIds[name] = p.id;
  };
  await mk("own-wins", { personCountry: "Argentina", companyCountry: "Chile", industry: TECH });
  await mk("company-chile", { companyCountry: "Chile", industry: FIN });
  await mk("alias-uruguay", { personCountry: "  ", companyCountry: "  ", aliasCountry: "Uruguay", industry: TECH });
  await mk("no-country", { industry: FIN, phone: "+5491155550000" });
  await mk("florida", { personCountry: "United States", industry: TECH, city: "Miami", region: "Florida" });
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

const page = async (over: Record<string, unknown> = {}) => {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  return listPickerPage({ ...DEFAULT_PICKER_QUERY, search: `Cty${run}`, ...over }, bdId, "?");
};
const ids = async (over: Record<string, unknown> = {}) => (await page(over)).contacts.map((c) => c.personId).sort();
const named = (...n: string[]) => n.map((x) => personIds[x]).sort();

test("the effective country: the person's own first, then the company's own row, then its alias target; blank text is no country", async () => {
  assert.deepEqual(await ids({ countries: ["Argentina"] }), named("own-wins"), "the person's Argentina beats the company's Chile");
  assert.deepEqual(await ids({ countries: ["Chile"] }), named("company-chile"), "...so the Chile chip does not hold that person");
  assert.deepEqual(await ids({ countries: ["Uruguay"] }), named("alias-uruguay"), "blank own country and blank own company -> the alias target's");
  assert.deepEqual(await ids({ noCountry: true }), named("no-country"));
});

test("countries and 'no country' are a union; both empty filters nothing; an unknown country matches nobody; it only narrows", async () => {
  const all = await ids();
  assert.equal(all.length, 5);
  assert.deepEqual(await ids({ countries: ["Argentina", "Chile"], noCountry: true }), named("own-wins", "company-chile", "no-country"));
  assert.deepEqual(await ids({ countries: [], noCountry: false }), all);
  assert.deepEqual(await ids({ countries: ["Atlantis"] }), []);
  for (const over of [{ countries: ["Chile"] }, { noCountry: true }, { countries: ["Argentina", "Uruguay"], noCountry: true }]) for (const id of await ids(over)) assert.ok(all.includes(id));
});

test("country counts: each chip equals the list it would give; its own selection is lifted, the industry selection applied", async () => {
  const c = (await page()).countryCounts!;
  const byValue: Record<string, number> = c.byValue;
  assert.deepEqual(c.byValue, { Argentina: 1, Chile: 1, Uruguay: 1, "United States": 1 });
  assert.equal(c.none, 1);
  assert.equal(c.total, 5);
  for (const k of Object.keys(byValue)) assert.equal(byValue[k], (await ids({ countries: [k] })).length, k);
  const picked = (await page({ countries: ["Chile"] })).countryCounts!;
  assert.deepEqual(picked, c, "choosing a country does not change the country chips");
  const tech = (await page({ industries: [TECH] })).countryCounts!;
  assert.deepEqual(tech.byValue, { Argentina: 1, Uruguay: 1, "United States": 1 }, "under Technology, Chile (a Banca contact) has nothing to give");
  assert.equal(tech.none, 0);
});

test("industry counts obey the country selection; signals obey both", async () => {
  const chile = await page({ countries: ["Chile"] });
  assert.deepEqual(chile.industryCounts!.byValue, { [FIN]: 1 }, "under Chile only the Banca contact is left");
  assert.equal(chile.industryCounts!.total, 1);
  assert.deepEqual((await page()).signalCounts, { florida: 1, hiring: 0 });
  assert.deepEqual((await page({ countries: ["Argentina"] })).signalCounts, { florida: 0, hiring: 0 }, "the Florida contact is US: outside the Argentina selection");
  assert.deepEqual((await page({ countries: ["United States"] })).signalCounts, { florida: 1, hiring: 0 });
  assert.deepEqual(await ids({ florida: true }), named("florida"));
});

test("a 'Cargar más' page returns no counts of either dimension", async () => {
  const p = await page({ offset: 50 });
  assert.equal(p.countryCounts, null);
  assert.equal(p.signalCounts, null);
  assert.equal(p.industryCounts, null);
});
