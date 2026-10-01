import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHotelPlan,
  resolveHotelCompanyKey,
  type ExistingCompany,
  type ExistingPerson,
  type HotelPlan,
  type PlanContext,
} from "@/lib/hoteles2026/plan";
import { HOTELES_SOURCE_KEY, parseHotelRows } from "@/lib/hoteles2026/rows";
import { BASE, sheetCsv } from "./hoteles2026Fixtures";

const MARIEL = "b2c7ef1d-cec2-46de-8a33-13c7860bfa17";
const OTHER_BD = "11111111-1111-4111-8111-111111111111";

const sheet = (rows: Parameters<typeof sheetCsv>[0]) => parseHotelRows(sheetCsv(rows));
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  marielBdId: MARIEL,
  candidates: [],
  companyAliasByKey: new Map(),
  existingCompaniesByKey: new Map(),
  ...over,
});
let n = 0;
const genId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const plan = (rows: Parameters<typeof sheetCsv>[0], c = ctx()) => buildHotelPlan(sheet(rows), c, genId);

/** The REAL producer: what a created row looks like once it is in `person`. */
const asExisting = (p: HotelPlan["creates"][number]): ExistingPerson => ({
  id: p.id!, sourceKey: p.sourceKey ?? null, profileKey: p.profileKey ?? null, emailNormalized: p.emailNormalized ?? null,
  firstName: p.firstName ?? null, lastName: p.lastName ?? null, company: p.company ?? null, companyKey: p.companyKey ?? null,
});

const EMAILLESS = { ...BASE, "Professional email": "" };

// --- company_key derivation (reuses normalizeCompanyKey + company_alias) -----
const KEYS: [string, string][] = [
  ["Catalonia Hotels & Resorts", "catalonia hotels & resorts"],
  ["ABI D'ORU BEACH HOTEL & SPA", "abi d'oru beach hotel & spa"],
  ["Palacio Arriluce Hotel, Member of The Leading Hotels of the World", "palacio arriluce hotel member of the leading hotels of the world"],
  ["Hotel Pérez, S.A.", "hotel perez"],
  ["Europa Tourist Group - Bibione & Lignano", "europa tourist group - bibione & lignano"],
];
for (const [raw, key] of KEYS) {
  test(`company_key for ${JSON.stringify(raw)}`, () => assert.equal(resolveHotelCompanyKey(raw, new Map()), key));
}

test("company_key resolves through company_alias to the canonical key", () => {
  assert.equal(resolveHotelCompanyKey("Hotel Catalonia", new Map([["hotel catalonia", "catalonia hotels & resorts"]])), "catalonia hotels & resorts");
});

// --- person / company mapping --------------------------------------------------
test("maps every field of a new person and company", () => {
  const p = plan([{ ...BASE, "Phone number": "+34 946 18 11 56" }]);
  assert.equal(p.creates.length, 1);
  const row = p.creates[0]!;
  assert.equal(row.sourceKey, HOTELES_SOURCE_KEY);
  assert.equal(row.ownerBdId, MARIEL);
  assert.equal(row.contactType, "BUYER-CHAMPION");
  assert.equal(row.roleGroup, "sales_bd");
  assert.equal(row.seniority, undefined);
  assert.equal(row.emailStatus, "probable");
  assert.equal(row.emailNormalized, "ana@hotel-uno.example");
  assert.equal(row.phone, "+34 946 18 11 56");
  assert.equal(row.mobilePhone, "+34 616 01 64 75");
  assert.equal(row.country, "Spain");
  assert.equal(row.companyKey, "hotel uno");
  assert.equal(row.profileKey, "linkedin.com/in/ana-prueba-1");
  assert.deepEqual(p.companiesToCreate, [{ companyKey: "hotel uno", displayName: "Hotel Uno", country: "Spain" }]);
});

test("email-less person gets status none and no email source", () => {
  const row = plan([EMAILLESS]).creates[0]!;
  assert.equal(row.email, null);
  assert.equal(row.emailStatus, "none");
  assert.equal(row.emailSource, null);
});

test("role_group comes from classifyPosition, not a local mapping", () => {
  const p = plan([{ ...BASE, "Job title": "Chief Technology Officer" }, { ...EMAILLESS, "Job title": "" , "LinkedIn profile URL": "https://www.linkedin.com/in/other"}]);
  assert.deepEqual(p.creates.map((c) => c.roleGroup), ["c_level_tech", "no_position"]);
});

// --- in-file duplicates --------------------------------------------------------
test("two rows sharing an email collapse into one person even with different LinkedIn URLs", () => {
  const p = plan([
    { ...BASE, "LinkedIn profile URL": "https://www.linkedin.com/in/borja-martínez-45643288", "Mobile phone": "+34 946 18 11 56" },
    { ...BASE, "LinkedIn profile URL": "https://www.linkedin.com/in/borja-mart%C3%ADnez-45643288" },
  ]);
  assert.equal(p.creates.length, 1);
  assert.equal(p.report.collapsedInFile.length, 1);
  assert.equal(p.report.rowsKept, 1);
});

// --- email-less keying ---------------------------------------------------------
test("email-less rows are keyed on the LinkedIn profile key", () => {
  const p = plan([EMAILLESS]);
  assert.deepEqual(p.report.emailLess, { total: 1, keyedByProfile: 1, keyedByNameCompany: 0 });
});

test("email-less row with no LinkedIn falls back to name+company", () => {
  const p = plan([{ ...EMAILLESS, "LinkedIn profile URL": "" }]);
  assert.deepEqual(p.report.emailLess, { total: 1, keyedByProfile: 0, keyedByNameCompany: 1 });
});

test("email-less row with no LinkedIn and no company has no key: skipped", () => {
  const p = plan([{ ...EMAILLESS, "LinkedIn profile URL": "", "Company name": "" }]);
  assert.equal(p.creates.length, 0);
  assert.deepEqual(p.report.skipped, [{ line: 1, reason: "no_identity_key" }]);
});

// --- idempotency ----------------------------------------------------------------
test("re-running over its own output creates nothing (email, LinkedIn and name+company keyed)", () => {
  const rows = [
    BASE,
    { ...EMAILLESS, "First name": "Beto", "LinkedIn profile URL": "https://www.linkedin.com/in/beto-1" },
    { ...EMAILLESS, "First name": "Carla", "LinkedIn profile URL": "", "Company name": "Hotel Dos" },
  ];
  const first = plan(rows);
  assert.equal(first.creates.length, 3);
  const second = plan(rows, ctx({ candidates: first.creates.map(asExisting) }));
  assert.equal(second.creates.length, 0);
  assert.equal(second.report.alreadyImported, 3);
  assert.deepEqual(second.report.skipped, []);
});

test("a match on a person from ANOTHER source is skipped and reported, never overwritten", () => {
  const other: ExistingPerson = { id: genId(), sourceKey: "linkedin_import", profileKey: "linkedin.com/in/ana-prueba-1", emailNormalized: null, firstName: "Ana", lastName: "Prueba", company: "Hotel Uno", companyKey: "hotel uno" };
  const p = plan([EMAILLESS], ctx({ candidates: [other] }));
  assert.equal(p.creates.length, 0);
  assert.deepEqual(p.report.skipped, [{ line: 1, reason: "exists_other_source", personId: other.id }]);
});

test("same name at the same company from another source is a possible duplicate, skipped", () => {
  const other: ExistingPerson = { id: genId(), sourceKey: "hubspot_import", profileKey: null, emailNormalized: null, firstName: "Ana", lastName: "Prueba", company: "Hotel Uno", companyKey: "hotel uno" };
  const p = plan([{ ...EMAILLESS, "LinkedIn profile URL": "" }], ctx({ candidates: [other] }));
  assert.deepEqual(p.report.skipped, [{ line: 1, reason: "possible_duplicate", personId: other.id }]);
});

// --- companies --------------------------------------------------------------------
const existingCompany = (ownerBdId: string | null): Map<string, ExistingCompany> =>
  new Map([["catalonia hotels & resorts", { companyKey: "catalonia hotels & resorts", displayName: "Catalonia Hotels & Resorts", ownerBdId }]]);
const CATALONIA = { ...BASE, "Company name": "Catalonia Hotels & Resorts" };

test("an existing unowned company is updated, not duplicated", () => {
  const p = plan([CATALONIA], ctx({ existingCompaniesByKey: existingCompany(null) }));
  assert.deepEqual(p.companiesToCreate, []);
  assert.deepEqual(p.companyOwnerUpdates, ["catalonia hotels & resorts"]);
  assert.equal(p.creates[0]!.companyKey, "catalonia hotels & resorts");
});

test("an existing company owned by another BD is left alone and reported", () => {
  const p = plan([CATALONIA], ctx({ existingCompaniesByKey: existingCompany(OTHER_BD) }));
  assert.deepEqual(p.companyOwnerUpdates, []);
  assert.deepEqual(p.report.companiesOwnedByOther, ["catalonia hotels & resorts"]);
});

test("a company already owned by Mariel is a no-op", () => {
  const p = plan([CATALONIA], ctx({ existingCompaniesByKey: existingCompany(MARIEL) }));
  assert.deepEqual(p.companyOwnerUpdates, []);
  assert.deepEqual(p.report.companiesOwnedByOther, []);
});

test("companies are only created for persons that are actually created", () => {
  const other: ExistingPerson = { id: genId(), sourceKey: "linkedin_import", profileKey: "linkedin.com/in/ana-prueba-1", emailNormalized: null, firstName: "Ana", lastName: "Prueba", company: "Hotel Uno", companyKey: "hotel uno" };
  assert.deepEqual(plan([EMAILLESS], ctx({ candidates: [other] })).companiesToCreate, []);
});

// --- report -----------------------------------------------------------------------
test("report counts created people by contact_type, role_group, email presence and country", () => {
  const p = plan([BASE, { ...EMAILLESS, "TYPE OF CONTACT": "INFLUENCER", Country: "Italy", "Mobile phone": "+39 338 661 5354", "LinkedIn profile URL": "https://www.linkedin.com/in/x-2" }]);
  assert.deepEqual(p.report.contactTypes, { "BUYER-CHAMPION": 1, INFLUENCER: 1 });
  assert.deepEqual(p.report.withEmail, 1);
  assert.deepEqual(p.report.withoutEmail, 1);
  assert.deepEqual(p.report.countries, { Spain: 1, Italy: 1 });
});

test("report lists the phone normalisations and dial-code mismatches by row", () => {
  const p = plan([{ ...BASE, Country: "Mexico", "Mobile phone": "+555579072182" }, { ...BASE, "Professional email": "b@x.example", "LinkedIn profile URL": "https://www.linkedin.com/in/b", "Mobile phone": "34900202000" }]);
  assert.deepEqual(p.report.phones.dialMismatchLines, [1]);
  assert.deepEqual(p.report.phones.addedPlusLines, [2]);
});

// --- pure planner ------------------------------------------------------------------
test("planner is pure: same input twice gives the same plan and inputs are untouched", () => {
  const parsed = sheet([BASE, EMAILLESS, CATALONIA]);
  const context = ctx({ existingCompaniesByKey: existingCompany(null) });
  const freeze = (o: object): void => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); };
  freeze(parsed); freeze(context);
  const ids = (): (() => string) => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; };
  const a = buildHotelPlan(parsed, context, ids());
  const b = buildHotelPlan(parsed, context, ids());
  assert.deepEqual(a, b);
});

test("every created person id is a real uuid, never a plan-local ref", () => {
  for (const c of plan([BASE]).creates) assert.match(c.id!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
