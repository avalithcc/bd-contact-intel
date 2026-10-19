/**
 * /admin/reports against a real Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed like the other
 * files here). Three owner-reported defects, 2026-10-19:
 *   1. the reply rate must leave out current clients (company won AND client_status active), through company_alias;
 *   2. "Empresas ganadas" must follow the selected period, dated by the move to 'won';
 *   3. a meeting counts in the period it HAPPENED (metadata.at), not the one it was logged in.
 * Everything is scoped to one throwaway BD (the BD filter), so rows already in the scratch database do not matter.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const NOW = new Date("2026-10-19T14:00:00Z"); // Monday 11:00 ART
const keys = {
  clientActive: `zz-client-active-${run}`,
  clientAlias: `zz-client-alias-${run}`,
  clientInactive: `zz-client-inactive-${run}`,
  wonNoStatus: `zz-won-null-${run}`,
  qualifiedActive: `zz-qualified-active-${run}`,
  wonThisWeek: `zz-won-week-${run}`,
  wonInitialLoad: `zz-won-initial-${run}`,
  wonInitialLoadEdge: `zz-won-edge-${run}`,
  wonOct08: `zz-won-oct08-${run}`,
  wonUndated: `zz-won-undated-${run}`,
  lostAfterWon: `zz-lost-${run}`,
};
let bdId: string;
const personIds: Record<string, string> = {};

async function insertPerson(name: string, status: string, companyKey: string | null, createdAt: Date) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${name}-${run}@reports.test`;
  const [p] = await db
    .insert(person)
    .values({ firstName: name, lastName: run, email, emailNormalized: email, ownerBdId: bdId, status, companyKey, createdAt })
    .returning();
  personIds[name] = p!.id;
}

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, company, companyAlias } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Reports", email: `zz-reports-${run}@example.test` }).returning();
  bdId = b!.id;

  const co = (companyKey: string, relationshipStage: string, clientStatus: string | null) =>
    ({ companyKey, displayName: companyKey, relationshipStage, clientStatus, ownerBdId: bdId }) as const;
  await db.insert(company).values([
    co(keys.clientActive, "won", "active"),
    co(keys.clientInactive, "won", "inactive"),
    co(keys.wonNoStatus, "won", null),
    co(keys.qualifiedActive, "qualified", "active"),
    co(keys.wonThisWeek, "won", null),
    co(keys.wonInitialLoad, "won", null),
    co(keys.wonInitialLoadEdge, "won", null),
    co(keys.wonOct08, "won", null),
    co(keys.wonUndated, "won", null),
    co(keys.lostAfterWon, "lost", null),
  ]);
  await db.insert(companyAlias).values({ aliasKey: keys.clientAlias, companyKey: keys.clientActive });

  // Reply-rate cohort: all created inside October 2026.
  const created = new Date("2026-10-10T15:00:00Z");
  await insertPerson("clientreplied", "replied", keys.clientActive, created);
  await insertPerson("aliasreplied", "replied", keys.clientAlias, created);
  await insertPerson("inactivereplied", "replied", keys.clientInactive, created);
  await insertPerson("nostatuscontacted", "contacted", keys.wonNoStatus, created);
  await insertPerson("qualifiedcontacted", "contacted", keys.qualifiedActive, created);
  await insertPerson("nocompany", "contacted", null, created);

  // Won dates: the move to 'won' is a company-scoped status_change activity, with the exact prod metadata shape
  // ({"from":"prospect","status":"won"}: the key is `status`, not `to`). Won before 2026-10-07 ART is the initial data load.
  const won = (companyKey: string, createdAt: Date) =>
    ({ companyKey, actorBdId: bdId, type: "status_change", metadata: { from: "prospect", status: "won" }, createdAt }) as const;
  await db.insert(activity).values([
    won(keys.wonThisWeek, new Date("2026-10-19T12:00:00Z")),
    won(keys.wonInitialLoad, new Date("2026-10-03T15:00:00Z")),
    won(keys.wonInitialLoadEdge, new Date("2026-10-07T02:59:59Z")), // 23:59:59 ART on the 6th: still the load
    won(keys.wonOct08, new Date("2026-10-08T15:00:00Z")),
    won(keys.lostAfterWon, new Date("2026-10-19T12:00:00Z")),
  ]);

  // Meeting logged 2026-09-30 15:43 ART, held 2026-10-02 (the prod case), plus one with no metadata.at.
  await insertPerson("meetingheld", "meeting", null, new Date("2026-09-01T12:00:00Z"));
  await db.insert(activity).values([
    { personId: personIds.meetingheld, actorBdId: bdId, type: "meeting_logged", metadata: { at: "2026-10-02T13:00:00.000Z", notes: null }, createdAt: new Date("2026-09-30T18:43:00Z") },
    { personId: personIds.meetingheld, actorBdId: bdId, type: "meeting_logged", metadata: { notes: "no date" }, createdAt: new Date("2026-10-05T15:00:00Z") },
  ]);
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.ownerBdId, bdId)); // cascades activity
  await db.delete(companyAlias).where(eq(companyAlias.aliasKey, keys.clientAlias));
  await db.delete(company).where(inArray(company.companyKey, Object.values(keys)));
  await db.delete(bd).where(eq(bd.id, bdId));
});

async function aggregates(period: Parameters<typeof import("@/lib/reports/period").reportPeriodRange>[0], custom?: { from: string; to: string }) {
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getReportAggregates } = await import("@/lib/reports/queriesDb");
  const range = reportPeriodRange(period, NOW, custom);
  return { range, result: await getReportAggregates({ fromIso: range.fromIso, toIso: range.toIso, bdId }) };
}

test("reply rate leaves out people of current clients (won + active), including through an alias, and keeps everyone else", async () => {
  const { result } = await aggregates("month");
  // Rate: included = won+inactive (replied), won+null, qualified+active, no company. Excluded = won+active and its alias.
  assert.equal(result.funnel.rateContacted, 4);
  assert.equal(result.funnel.rateReplied, 1);
});

test("a contact at a current client still counts in 'Contactos nuevos', the funnel and the source table; only the rate leaves them out", async () => {
  const { result } = await aggregates("month");
  assert.equal(result.funnel.newTotal, 6, "all six cohort people, clients included");
  assert.equal(result.funnel.contactedOrMore, 6);
  assert.equal(result.funnel.repliedOrMore, 3, "the two client contacts replied and still show in Respondió");
  const sourceTotal = result.sourceStatus.reduce((n, r) => n + r.count, 0);
  assert.equal(sourceTotal, 6);
});

test("the cohort lists include clients, except the reply-rate tile's list which matches its number", async () => {
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getCohortDrilldown } = await import("@/lib/reports/queriesDb");
  const range = reportPeriodRange("month", NOW);
  const base = { fromIso: range.fromIso, toIso: range.toIso, bdId };
  const everyone = await getCohortDrilldown({ ...base, population: "replied" });
  assert.equal(everyone.length, 3);
  const nuevos = await getCohortDrilldown({ ...base, population: "new" });
  assert.equal(nuevos.length, 6);
  const rate = await getCohortDrilldown({ ...base, population: "replied", excludeClients: true });
  assert.deepEqual(rate.map((r) => r.personId), [personIds.inactivereplied]);
});

test("'Empresas ganadas' follows the period", async () => {
  assert.equal((await aggregates("week")).result.wonInPeriod, 1, "only the company that moved to won on Monday");
  assert.equal((await aggregates("month")).result.wonInPeriod, 2, "Oct 8 and Oct 19");
  assert.equal((await aggregates("custom", { from: "2026-07-01", to: "2026-12-31" })).result.wonInPeriod, 2, "a custom range over the quarter");
  assert.equal((await aggregates("custom", { from: "2026-10-12", to: "2026-10-18" })).result.wonInPeriod, 0, "nothing moved to won Oct 12-18");
});

test("won before the tracking start (initial data load, Oct 1-6) is in no period, even October; Oct 8 is in October", async () => {
  const { WON_TRACKING_STARTS_AT_ISO } = await import("@/lib/reports/wonTracking");
  assert.equal(WON_TRACKING_STARTS_AT_ISO, "2026-10-07T03:00:00.000Z");
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getWonCompaniesDrilldown } = await import("@/lib/reports/queriesDb");
  const october = reportPeriodRange("month", NOW);
  const rows = await getWonCompaniesDrilldown({ fromIso: october.fromIso, toIso: october.toIso, bdId });
  assert.deepEqual(rows.map((r) => r.companyKey), [keys.wonThisWeek, keys.wonOct08]);
  assert.equal((await aggregates("last_month")).result.wonInPeriod, 0);
});

test("won companies with no real close date (no recorded move, or the initial load) are counted apart", async () => {
  const week = await aggregates("week");
  // no status_change: client active/inactive, won/no status, undated (4); initial load: Oct 3 and the Oct 6 23:59:59 edge (2)
  assert.equal(week.result.wonUndated, 6);
  assert.equal(week.result.wonInPeriod, 1);
});

async function meetingsIn(period: Parameters<typeof import("@/lib/reports/period").reportPeriodRange>[0]) {
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getMeetingsDrilldown, getReportPerBd } = await import("@/lib/reports/queriesDb");
  const range = reportPeriodRange(period, NOW);
  const perBd = await getReportPerBd({ fromIso: range.fromIso, toIso: range.toIso, fromDate: range.fromDate, toDateExclusive: range.toDateExclusive, bdId });
  const drill = await getMeetingsDrilldown({ fromIso: range.fromIso, toIso: range.toIso, bdId });
  return { count: perBd.find((r) => r.bdId === bdId)!.meetings, listed: drill.length };
}

test("a meeting logged Sep 30 and held Oct 2 counts in Q4, not Q3 (metadata.at); one without metadata.at falls back to created_at", async () => {
  const q4 = await meetingsIn("month");
  assert.deepEqual(q4, { count: 2, listed: 2 }, "held Oct 2 + the undated one logged Oct 5");
  const q3 = await meetingsIn("last_month");
  assert.deepEqual(q3, { count: 0, listed: 0 }, "logged in Q3 but held in Q4");
  const october = await meetingsIn("month");
  assert.equal(october.count, 2);
  const lastMonth = await meetingsIn("last_month");
  assert.equal(lastMonth.count, 0);
});
