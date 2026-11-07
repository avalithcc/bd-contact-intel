/**
 * /admin/reports against a real Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed like the other
 * files here). Three owner-reported defects, 2026-10-19:
 *   1. the reply rate must leave out current clients (company won AND client_status active), through company_alias;
 *   2. "Empresas ganadas" must follow the selected period, dated by the move to 'won';
 *   3. a meeting counts in the period it HAPPENED (metadata.at), not the one it was logged in.
 * Plus the fourth, 2026-11-06: the reply rate must be DATED on both sides — persons contacted in the period, and the
 * ones among them who replied in it after that contact — never `person.status` over the persons created in it. Each
 * fixture below carries the `person.status` the old snapshot rule read, so this file fails loudly if that rule ever
 * comes back.
 *
 * Production runs the SQL in queries.ts, not the pure twin in replyRateEvidence.ts, so every branch of the two
 * evidence predicates gets a real row here: a wrong `metadata` key would otherwise pass the whole unit suite (see
 * "test the producer, not just the consumer"). The evidence matrix is `RATE_CASES` below, one row per branch, and the
 * expected counts are derived from it rather than hand-copied.
 *
 * Everything is scoped to one throwaway BD (the BD filter), so rows already in the scratch database do not matter.
 * The one test that runs with `bdId: null` takes a baseline before inserting anything and asserts the exact delta.
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
/** October's rate BEFORE this file inserts anything, so the `bdId: null` read can assert an exact delta. */
let baseline = { contacted: 0, replied: 0 };

async function insertPerson(name: string, status: string, companyKey: string | null, createdAt: Date, profileKey?: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${name}-${run}@reports.test`;
  const [p] = await db
    .insert(person)
    .values({ firstName: name, lastName: run, email, emailNormalized: email, ownerBdId: bdId, status, companyKey, createdAt, profileKey })
    .returning();
  personIds[name] = p!.id;
}

/** One `activity` row for a person, with its real `created_at` (the rate dates it through effectiveActivityAtSql). */
async function logActivity(name: string, type: string, at: Date, metadata: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  await db.insert(activity).values({ personId: personIds[name], actorBdId: bdId, type, metadata, createdAt: at });
}

/**
 * One imported LinkedIn thread with its messages, linked to the person by `peer_profile_key = person.profile_key`.
 * `received` = the message came from the peer. These rows exist to prove LinkedIn traffic is IGNORED by the rate
 * (owner decision 2026-11-06): the `messages.csv` export carries every conversation the BD ever had — colleagues,
 * inbound recruiters, personal chat — so it is not prospecting evidence.
 */
async function insertThread(externalId: string, peerProfileKey: string, messages: readonly { at: Date; received: boolean }[]) {
  const { db } = await import("@/db");
  const { conversation, message } = await import("@/db/schema");
  const [c] = await db.insert(conversation).values({ bdId, externalId: `${externalId}-${run}`, peerProfileKey }).returning();
  await db.insert(message).values(
    messages.map((m, i) => ({
      bdId,
      conversationId: c!.id,
      senderProfileKey: m.received ? peerProfileKey : `zz-own-bd-${run}`,
      sentAt: m.at,
      content: `zz ${externalId} ${i}`,
      contentHash: `zz-${externalId}-${run}-${i}`,
    })),
  );
}

interface RateCase {
  name: string;
  /** What deriveStatus writes for this person today — the value the old snapshot rule read. */
  status: string;
  events: ReadonlyArray<{ type: string; at: string; metadata?: Record<string, unknown> }>;
  linkedIn?: ReadonlyArray<{ at: string; received: boolean }>;
  /** What October's DATED rate must say. */
  contacted: boolean;
  /** The first qualifying reply, when `contacted && replied`. */
  replyAt?: string;
  why: string;
}

/**
 * One case per branch of the two evidence predicates, plus the period and LinkedIn rules. Every person here is
 * created in SEPTEMBER, so none is in October's cohort: the funnel card must not move, and the denominator is
 * "contacted in the period", whatever the creation date. The expected counts are derived from this table.
 */
const RATE_CASES: readonly RateCase[] = [
  { name: "repliedearlier", status: "replied", contacted: false, why: "contacted in September, replied in October: in neither month's rate",
    events: [{ type: "email_sent", at: "2026-09-20T12:00:00Z" }, { type: "reply_received", at: "2026-10-03T12:00:00Z" }] },
  { name: "neutralonly", status: "contacted", contacted: true, why: "auto_reply_received and call_attempt move nothing",
    events: [
      { type: "email_sent", at: "2026-10-02T12:00:00Z" },
      { type: "auto_reply_received", at: "2026-10-03T12:00:00Z" },
      { type: "call_attempt", at: "2026-10-04T12:00:00Z", metadata: { direction: "outbound" } },
    ] },
  { name: "backfillimport", status: "replied", contacted: true, why: "a status_backfill is dated by metadata.originalAt (2023), not by when the import ran",
    events: [
      { type: "email_sent", at: "2026-10-09T12:00:00Z" },
      { type: "status_backfill", at: "2026-10-15T12:00:00Z", metadata: { status: "replied", originalAt: "2023-02-01T10:00:00.000Z" } },
    ] },
  { name: "linkedinonly", status: "replied", contacted: false, why: "LinkedIn conversation traffic alone is not outreach and not a reply (83% of the metric came in this way)",
    events: [], linkedIn: [{ at: "2026-10-04T12:00:00Z", received: false }, { at: "2026-10-08T12:00:00Z", received: true }] },
  { name: "linkedinanswer", status: "replied", contacted: true, why: "answered only on LinkedIn: denominator with no credit — the understatement the owner accepted",
    events: [{ type: "email_sent", at: "2026-10-06T12:00:00Z" }],
    linkedIn: [{ at: "2026-10-08T12:00:00Z", received: true }, { at: "2026-10-16T12:00:00Z", received: true }] },
  { name: "calloutbound", status: "contacted", contacted: true, why: "an outbound call with any outcome is contact evidence",
    events: [{ type: "call", at: "2026-10-06T12:00:00Z", metadata: { direction: "outbound", outcome: "no_answer" } }] },
  { name: "callconnected", status: "replied", contacted: true, replyAt: "2026-10-07T12:00:00.000Z",
    why: "an outbound CONNECTED call is both the touch and the conversation (owner rule 2026-09-26, deliberately kept)",
    events: [{ type: "call", at: "2026-10-07T12:00:00Z", metadata: { direction: "outbound", outcome: "connected" } }] },
  { name: "callinboundmiss", status: "contacted", contacted: true, why: "an inbound call that did not connect is not a reply",
    events: [
      { type: "email_sent", at: "2026-10-02T12:00:00Z" },
      { type: "call", at: "2026-10-05T12:00:00Z", metadata: { direction: "inbound", outcome: "no_answer" } },
    ] },
  { name: "callinboundonly", status: "new", contacted: false, why: "an inbound call that did not connect is not outreach either",
    events: [{ type: "call", at: "2026-10-05T12:00:00Z", metadata: { direction: "inbound", outcome: "no_answer" } }] },
  { name: "whatsappsent", status: "contacted", contacted: true, why: "a sent WhatsApp is contact evidence",
    events: [{ type: "whatsapp", at: "2026-10-03T12:00:00Z", metadata: { outcome: "sent" } }] },
  { name: "whatsappreplied", status: "replied", contacted: true, replyAt: "2026-10-04T12:00:00.000Z", why: "an answered WhatsApp is a reply",
    events: [
      { type: "whatsapp", at: "2026-10-03T12:00:00Z", metadata: { outcome: "sent" } },
      { type: "whatsapp", at: "2026-10-04T12:00:00Z", metadata: { outcome: "replied" } },
    ] },
  { name: "statuscontacted", status: "contacted", contacted: true, why: "a manual move to Contactado is dated outreach",
    events: [{ type: "status_change", at: "2026-10-05T12:00:00Z", metadata: { status: "contacted" } }] },
  { name: "statusreplied", status: "replied", contacted: false,
    why: "a manual move to Respondió is a reply ONLY: it must not be its own outreach, or one click would manufacture a 100% hit",
    events: [{ type: "status_change", at: "2026-10-05T12:00:00Z", metadata: { status: "replied" } }] },
  { name: "statusmeeting", status: "meeting", contacted: false, why: "same for a manual move to Reunión",
    events: [{ type: "status_change", at: "2026-10-05T12:00:00Z", metadata: { status: "meeting" } }] },
  { name: "statusthenreplied", status: "replied", contacted: true, replyAt: "2026-10-09T12:00:00.000Z", why: "contacted then answered by hand: a real dated sequence",
    events: [
      { type: "status_change", at: "2026-10-05T12:00:00Z", metadata: { status: "contacted" } },
      { type: "status_change", at: "2026-10-09T12:00:00Z", metadata: { status: "replied" } },
    ] },
  { name: "meetinglogged", status: "meeting", contacted: true, replyAt: "2026-10-06T12:00:00.000Z", why: "a held meeting is a reply",
    events: [{ type: "email_sent", at: "2026-10-02T12:00:00Z" }, { type: "meeting_logged", at: "2026-10-06T12:00:00Z" }] },
  { name: "replybeforethenafter", status: "replied", contacted: true, replyAt: "2026-10-13T12:00:00.000Z",
    why: "the reply date shown is the first QUALIFYING one, not the first in the window",
    events: [
      { type: "email_sent", at: "2026-10-10T12:00:00Z" },
      { type: "reply_received", at: "2026-10-08T12:00:00Z" },
      { type: "reply_received", at: "2026-10-13T12:00:00Z" },
    ] },
];

const repliedCase = (c: RateCase) => c.contacted && c.replyAt !== undefined;
/** The four non-client cohort people below, each with an October email; one of them (inactivereplied) also replied. */
const COHORT_IN_RATE = { contacted: 4, replied: 1 };
const EXPECTED_RATE = {
  contacted: COHORT_IN_RATE.contacted + RATE_CASES.filter((c) => c.contacted).length,
  replied: COHORT_IN_RATE.replied + RATE_CASES.filter(repliedCase).length,
};

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, company, companyAlias } = await import("@/db/schema");
  const { getReportAggregates } = await import("@/lib/reports/queriesDb");
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const october = reportPeriodRange("month", NOW);
  const before = await getReportAggregates({ fromIso: october.fromIso, toIso: october.toIso, bdId: null });
  baseline = { contacted: before.funnel.rateContacted, replied: before.funnel.rateReplied };

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

  // Reply-rate cohort: all created inside October 2026, each with dated October evidence matching its status.
  const created = new Date("2026-10-10T15:00:00Z");
  await insertPerson("clientreplied", "replied", keys.clientActive, created);
  await insertPerson("aliasreplied", "replied", keys.clientAlias, created);
  await insertPerson("inactivereplied", "replied", keys.clientInactive, created);
  await insertPerson("nostatuscontacted", "contacted", keys.wonNoStatus, created);
  await insertPerson("qualifiedcontacted", "contacted", keys.qualifiedActive, created);
  await insertPerson("nocompany", "contacted", null, created);
  for (const name of ["clientreplied", "aliasreplied", "inactivereplied", "nostatuscontacted", "qualifiedcontacted", "nocompany"]) {
    await logActivity(name, "email_sent", new Date("2026-10-11T15:00:00Z"));
  }
  for (const name of ["clientreplied", "aliasreplied", "inactivereplied"]) {
    await logActivity(name, "reply_received", new Date("2026-10-12T15:00:00Z"));
  }

  // Every branch of the evidence rule, one person per case (RATE_CASES above), all created in SEPTEMBER.
  const earlier = new Date("2026-09-15T12:00:00Z");
  for (const c of RATE_CASES) {
    const profileKey = c.linkedIn ? `zz-${c.name}-${run}` : undefined;
    await insertPerson(c.name, c.status, null, earlier, profileKey);
    for (const e of c.events) await logActivity(c.name, e.type, new Date(e.at), e.metadata ?? {});
    if (c.linkedIn && profileKey) {
      await insertThread(c.name, profileKey, c.linkedIn.map((m) => ({ at: new Date(m.at), received: m.received })));
    }
  }

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

/** October's numerator list, fetched once per test that needs it. */
async function rateRows(scoped = true) {
  const { getRateDrilldown } = await import("@/lib/reports/queriesDb");
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const range = reportPeriodRange("month", NOW);
  return getRateDrilldown({ fromIso: range.fromIso, toIso: range.toIso, bdId: scoped ? bdId : null });
}

test("reply rate leaves out people of current clients (won + active), including through an alias, and keeps everyone else", async () => {
  const { result } = await aggregates("month");
  // Derived from RATE_CASES + the four non-client cohort people, so adding a case can never leave a stale number here.
  assert.equal(result.funnel.rateContacted, EXPECTED_RATE.contacted);
  assert.equal(result.funnel.rateReplied, EXPECTED_RATE.replied);
  // Spelled out once, so a wrong derivation cannot hide behind the same arithmetic on both sides.
  assert.equal(EXPECTED_RATE.contacted, 16);
  assert.equal(EXPECTED_RATE.replied, 6);
});

test("every branch of the evidence rule lands where it should, against real SQL", async () => {
  const rows = await rateRows();
  const inNumerator = new Set(rows.map((r) => r.personId));
  const { result } = await aggregates("month");
  for (const c of RATE_CASES) {
    const id = personIds[c.name]!;
    assert.equal(inNumerator.has(id), repliedCase(c), `${c.name}: ${c.why}`);
  }
  // The denominator is checked through the count (there is no list for it), so pin the two halves together.
  assert.equal(rows.length, result.funnel.rateReplied, "the list behind the number IS the number");
});

test("LinkedIn conversation traffic is out of the metric on BOTH sides (owner decision 2026-11-06)", async () => {
  const { result } = await aggregates("month");
  const inNumerator = new Set((await rateRows()).map((r) => r.personId));
  // Only LinkedIn traffic, no CRM outreach: in neither side. This is the 83% of persons the shipped version let in.
  assert.equal(inNumerator.has(personIds.linkedinonly!), false);
  // ...and it is not in the denominator either, which is what makes the whole count 16 and not 17.
  assert.equal(result.funnel.rateContacted, 16);
  // Answered only on LinkedIn after a real email: denominator, no credit. The understatement the owner accepted.
  assert.equal(inNumerator.has(personIds.linkedinanswer!), false);
});

test("a manual move to Respondió is a reply, never its own outreach", async () => {
  const inNumerator = new Set((await rateRows()).map((r) => r.personId));
  // Both would be a guaranteed hit in numerator AND denominator if status_change kept 'replied'/'meeting' on the
  // outreach side: one click, 100%.
  assert.equal(inNumerator.has(personIds.statusreplied!), false);
  assert.equal(inNumerator.has(personIds.statusmeeting!), false);
  // The real sequence still counts.
  assert.equal(inNumerator.has(personIds.statusthenreplied!), true);
});

test("the reply date shown is the first QUALIFYING event, not the first reply in the window", async () => {
  const byId = new Map((await rateRows()).map((r) => [r.personId, r]));
  for (const c of RATE_CASES.filter(repliedCase)) {
    const row = byId.get(personIds[c.name]!)!;
    assert.ok(row.replyAt instanceof Date, `${c.name} must carry a real reply date`);
    assert.equal(row.replyAt!.toISOString(), c.replyAt, c.why);
  }
  assert.equal(byId.get(personIds.inactivereplied!)!.replyAt!.toISOString(), "2026-10-12T15:00:00.000Z");
});

test("the numerator list is ordered by its own reply date, most recent first", async () => {
  const rows = await rateRows();
  const dates = rows.map((r) => r.replyAt!.getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  assert.equal(rows[0]!.personId, personIds.replybeforethenafter, "Oct 13 is the latest qualifying reply");
});

test("a person contacted in the period but created long before it is in the denominator (the old rule could not see them)", async () => {
  const { result } = await aggregates("month");
  assert.equal(result.funnel.newTotal, 6, "the funnel's cohort is unchanged: only the six created in October");
  assert.equal(result.funnel.contactedOrMore, 6);
  assert.equal(result.funnel.rateContacted, 16, "the rate is not bounded by the cohort: 12 of these were created in September");
});

test('"Todos los BDs" (bdId null) adds exactly this BD\'s rows to whatever the database already held', async () => {
  const { getReportAggregates } = await import("@/lib/reports/queriesDb");
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const range = reportPeriodRange("month", NOW);
  const all = await getReportAggregates({ fromIso: range.fromIso, toIso: range.toIso, bdId: null });
  assert.equal(all.funnel.rateContacted, baseline.contacted + EXPECTED_RATE.contacted);
  assert.equal(all.funnel.rateReplied, baseline.replied + EXPECTED_RATE.replied);
  const inNumerator = new Set((await rateRows(false)).map((r) => r.personId));
  for (const c of RATE_CASES.filter(repliedCase)) {
    assert.equal(inNumerator.has(personIds[c.name]!), true, `${c.name} must survive the unfiltered read too`);
  }
  assert.equal(inNumerator.has(personIds.clientreplied!), false, "current clients stay out with no BD filter either");
});

test("September's rate is its own: contacted in September, replied in October counts for neither month", async () => {
  const september = await aggregates("last_month");
  // repliedearlier is the only September outreach; its reply arrived in October, so September is 1 contacted, 0 replied.
  assert.equal(september.result.funnel.rateContacted, 1);
  assert.equal(september.result.funnel.rateReplied, 0);
});

test("a contact at a current client still counts in 'Contactos nuevos', the funnel and the source table; only the rate leaves them out", async () => {
  const { result } = await aggregates("month");
  assert.equal(result.funnel.newTotal, 6, "all six cohort people, clients included");
  assert.equal(result.funnel.contactedOrMore, 6);
  assert.equal(result.funnel.repliedOrMore, 3, "the two client contacts replied and still show in Respondió");
  const sourceTotal = result.sourceStatus.reduce((n, r) => n + r.count, 0);
  assert.equal(sourceTotal, 6);
});

test("the cohort lists include clients and stay the created-in-period cohort; the rate's list is a different population", async () => {
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getCohortDrilldown, getRateDrilldown } = await import("@/lib/reports/queriesDb");
  const range = reportPeriodRange("month", NOW);
  const base = { fromIso: range.fromIso, toIso: range.toIso, bdId };
  const everyone = await getCohortDrilldown({ ...base, population: "replied" });
  assert.equal(everyone.length, 3, "clients included, September-created people excluded");
  const nuevos = await getCohortDrilldown({ ...base, population: "new" });
  assert.equal(nuevos.length, 6);
  const rate = await getRateDrilldown(base);
  assert.equal(rate.length, EXPECTED_RATE.replied, "a different population: 12 of these were created in September");
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
  // Derived, not hard-coded: this KPI reads every meeting_logged row this file inserts, including the one RATE_CASES
  // needs to cover the "a held meeting is a reply" branch. Its own two rows are what the assertion is about.
  const fromRateCases = RATE_CASES.reduce((n, c) => n + c.events.filter((e) => e.type === "meeting_logged").length, 0);
  const q4 = await meetingsIn("month");
  assert.equal(fromRateCases, 1);
  assert.deepEqual(q4, { count: 2 + fromRateCases, listed: 2 + fromRateCases }, "held Oct 2 + the undated one logged Oct 5");
  const q3 = await meetingsIn("last_month");
  assert.deepEqual(q3, { count: 0, listed: 0 }, "logged in Q3 but held in Q4");
});
