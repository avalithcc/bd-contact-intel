/**
 * Outreach lanes against a scratch database: each lane's population, the role-group visibility rule on both lanes,
 * and the live counts behind the lane badges and the ready_for_email legend.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database. Rows are committed (the read uses the
 * shared pool) under a per-run token and removed afterwards. Counts are asserted as deltas over a baseline taken before
 * seeding, so other rows in the scratch database cannot change the verdict.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const lastName = `Lane${run}`;
const hiringKey = `zz-${run}-hiring`;
const plainKey = `zz-${run}-plain`;
const offshoreKey = `zz-${run}-offshore`;
const ids: Record<string, string> = {};
const personIds: string[] = [];
let bdId = "";
let baseline: Awaited<ReturnType<typeof import("@/lib/outreach/queries").getOutreachLaneSummary>>;

type Seed = {
  key: string;
  status?: string;
  emailStatus?: string;
  roleGroup?: string | null;
  contactType?: string | null;
  merged?: boolean;
  activities?: string[];
  sentCount?: number;
};
// Which lane(s) each person belongs to is the invariant under test; the names say it.
const SEEDS: Record<string, Seed> = {
  hiringNew: { key: hiringKey, status: "new", emailStatus: "none" },
  hiringContactedVerified: { key: hiringKey, status: "contacted", emailStatus: "verified", activities: ["status_backfill"] },
  plainContactedVerifiedBackfill: { key: plainKey, status: "contacted", emailStatus: "verified", activities: ["status_backfill"] },
  plainContactedVerifiedEmailSent: { key: plainKey, status: "contacted", emailStatus: "verified", activities: ["email_sent"] },
  plainContactedVerifiedLinkedin: { key: plainKey, status: "contacted", emailStatus: "verified", sentCount: 2 },
  plainContactedProbable: { key: plainKey, status: "contacted", emailStatus: "probable" },
  plainNewVerified: { key: plainKey, status: "new", emailStatus: "verified" },
  plainRepliedVerified: { key: plainKey, status: "replied", emailStatus: "verified" },
  plainMerged: { key: plainKey, status: "contacted", emailStatus: "verified", merged: true },
  hiddenDevPlain: { key: plainKey, status: "contacted", emailStatus: "verified", roleGroup: "developers" },
  hiddenDevHiring: { key: hiringKey, status: "new", emailStatus: "none", roleGroup: "developers" },
  buyerDevPlain: { key: plainKey, status: "contacted", emailStatus: "verified", roleGroup: "developers", contactType: "BUYER-CHAMPION" },
  buyerDevHiring: { key: hiringKey, status: "new", emailStatus: "none", roleGroup: "developers", contactType: "BUYER-CHAMPION" },
  // An offshore-hub posting: hideOffshore, if honored, would drop this company from the hiring index.
  offshoreContactedVerified: { key: offshoreKey, status: "contacted", emailStatus: "verified" },
  nullRolePlain: { key: plainKey, status: "contacted", emailStatus: "verified", roleGroup: null },
};

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, company, jobPosting, person, personBdConnection, targetCompany } = await import("@/db/schema");
  const { getOutreachLaneSummary } = await import("@/lib/outreach/queries");
  baseline = await getOutreachLaneSummary(db, [hiringKey], []);

  const [me] = await db.insert(bd).values({ email: `zz-lane-${run}@example.test`, name: "ZZ lane" }).returning();
  bdId = me!.id;
  // The hiring company goes through the real producer: target_company + a fresh open IT posting.
  for (const k of [hiringKey, plainKey, offshoreKey]) await db.insert(company).values({ companyKey: k, displayName: k });
  for (const k of [hiringKey, offshoreKey]) await db.insert(targetCompany).values({ companyKey: k, displayName: k, ats: "lever", config: {} });
  await db.insert(jobPosting).values({
    companyKey: hiringKey, externalId: "1", title: "Engineer", location: "Austin, TX", url: "https://example.test",
    isIt: true, market: "us", postedAt: new Date(), firstSeen: new Date(), closedAt: null,
  });
  await db.insert(jobPosting).values({
    companyKey: offshoreKey, externalId: "1", title: "Engineer", location: "Bangalore, India", url: "https://example.test", isOffshoreHub: true,
    isIt: true, market: "other", postedAt: new Date(), firstSeen: new Date(), closedAt: null,
  });

  let mergeTarget: string | null = null;
  for (const [name, s] of Object.entries(SEEDS)) {
    const [p] = await db
      .insert(person)
      .values({
        firstName: name, lastName, company: s.key, companyKey: s.key,
        status: s.status ?? "new", emailStatus: s.emailStatus ?? "none",
        roleGroup: s.roleGroup === undefined ? null : s.roleGroup, contactType: s.contactType ?? null,
        mergedIntoId: s.merged ? (mergeTarget ??= ids.hiringNew ?? null) : null,
      })
      .returning();
    ids[name] = p!.id;
    personIds.push(p!.id);
    for (const type of s.activities ?? []) await db.insert(activity).values({ personId: p!.id, actorBdId: bdId, type, metadata: {} });
    if (s.sentCount) await db.insert(personBdConnection).values({ personId: p!.id, bdId, sentCount: s.sentCount, messageCount: s.sentCount });
  }
});

after(async () => {
  const { db } = await import("@/db");
  const { activity, bd, company, jobPosting, person, personBdConnection, targetCompany } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  if (personIds.length) {
    await db.delete(activity).where(inArray(activity.personId, personIds));
    await db.delete(personBdConnection).where(inArray(personBdConnection.personId, personIds));
    await db.delete(person).where(inArray(person.id, personIds));
  }
  await db.delete(jobPosting).where(inArray(jobPosting.companyKey, [hiringKey, offshoreKey]));
  await db.delete(targetCompany).where(inArray(targetCompany.companyKey, [hiringKey, offshoreKey]));
  await db.delete(company).where(inArray(company.companyKey, [hiringKey, plainKey, offshoreKey]));
  if (bdId) await db.delete(bd).where(eq(bd.id, bdId));
  await db.$client.end();
});

async function lane(laneKey: "hiring" | "ready_for_email", opts: { hidden?: string[]; filters?: object; empty?: boolean } = {}) {
  const { listOutreachCandidates } = await import("@/lib/outreach/queries");
  const t0 = performance.now();
  const page = await listOutreachCandidates(bdId, { name: lastName, ...opts.filters }, 1, 500, {
    lane: laneKey,
    hiddenRoleGroups: (opts.hidden ?? []) as never,
    ...(opts.empty ? { hiringIndex: new Map() } : {}),
  });
  const ms = Math.round(performance.now() - t0);
  const names = page.rows.map((r) => r.firstName!).sort();
  console.log(`lane=${laneKey} hidden=${(opts.hidden ?? []).join("+") || "-"} rows=${page.total} ${ms}ms`);
  return { names, page };
}

const HIDDEN = ["developers", "sales_bd"];
const readyAll = [
  "hiringContactedVerified", "plainContactedVerifiedBackfill", "plainContactedVerifiedEmailSent", "plainContactedVerifiedLinkedin",
  "hiddenDevPlain", "buyerDevPlain", "nullRolePlain", "offshoreContactedVerified",
].sort();

test("ready_for_email still returns its rows when the hiring index is EMPTY (the old early return would have returned none)", async () => {
  const { names, page } = await lane("ready_for_email", { empty: true });
  assert.equal(page.hiringCompanyCount, 0);
  assert.deepEqual(names, readyAll);
});

test("ready_for_email population is contacted + verified email, minus merged, probable, new and replied; hiring is not required", async () => {
  const { names } = await lane("ready_for_email");
  for (const out of ["plainContactedProbable", "plainNewVerified", "plainRepliedVerified", "plainMerged", "hiringNew"]) {
    assert.equal(names.includes(out), false, out);
  }
  assert.ok(names.includes("plainContactedVerifiedBackfill"), "a contact at a company with no posting is in the lane");
  assert.ok(names.includes("hiringContactedVerified"), "and so is one at a hiring company");
});

test("hiring population is exactly the contacts at companies with a fresh open IT posting, whatever their status or email", async () => {
  const { names } = await lane("hiring");
  assert.deepEqual(names, ["buyerDevHiring", "hiddenDevHiring", "hiringContactedVerified", "hiringNew", "offshoreContactedVerified"]);
});

test("a hidden role group is excluded from both lanes while a BUYER-CHAMPION in that group and a NULL role group stay", async () => {
  const ready = await lane("ready_for_email", { hidden: HIDDEN });
  assert.equal(ready.names.includes("hiddenDevPlain"), false);
  assert.ok(ready.names.includes("buyerDevPlain"));
  assert.ok(ready.names.includes("nullRolePlain"));
  assert.deepEqual(ready.names, readyAll.filter((n) => n !== "hiddenDevPlain"));

  const hiring = await lane("hiring", { hidden: HIDDEN });
  assert.equal(hiring.names.includes("hiddenDevHiring"), false);
  assert.ok(hiring.names.includes("buyerDevHiring"));
  assert.deepEqual(hiring.names, ["buyerDevHiring", "hiringContactedVerified", "hiringNew", "offshoreContactedVerified"]);
});

test("ready_for_email IGNORES excludeNever: a contact who was never messaged stays in the lane", async () => {
  const plain = await lane("ready_for_email");
  const loaded = await lane("ready_for_email", { filters: { includeNeverMessaged: false } });
  assert.deepEqual(loaded.names, plain.names);
  assert.ok(loaded.names.length > 0);
});

// In ready_for_email the hiring index never reaches the WHERE, so a posting filter that leaked through would only
// narrow the INDEX: rows stay the same and openItCount / the Contratando badge silently drop. Assert on openItCount.
for (const [key, filters, who] of [
  ["market", { market: "latam" }, "hiringContactedVerified"],
  ["miamiOnly", { market: "us", miamiOnly: true }, "hiringContactedVerified"],
  ["startupsOnly", { startupsOnly: true }, "hiringContactedVerified"],
  ["hideOffshore", { hideOffshore: true }, "offshoreContactedVerified"],
] as const) {
  test(`ready_for_email ignores ${key}: the contact's openItCount is the unfiltered value, not the filtered index's`, async () => {
    const open = async (f: object) => {
      const { page } = await lane("ready_for_email", { filters: f });
      const row = page.rows.find((r) => r.firstName === who)!;
      return { count: row.openItCount, rows: page.rows.length };
    };
    const base = await open({});
    assert.equal(base.count, 1, "unfiltered, the seeded posting counts");
    const filtered = await open(filters);
    assert.deepEqual(filtered, base);
    // The same filter in the hiring lane DOES narrow the index (proof the filter would have bitten here).
    const { page } = await lane("hiring", { filters });
    assert.equal(page.rows.some((r) => r.firstName === who), false, `${key} must narrow the hiring lane`);
  });
}

test("hiring keeps its posting-derived filters: excludeNever drops everyone who was never messaged", async () => {
  const all = await lane("hiring");
  const messaged = await lane("hiring", { filters: { includeNeverMessaged: false } });
  assert.ok(messaged.names.length < all.names.length);
});

test("the lane summary counts each source over the ready population, as independent overlapping counts", async () => {
  const { db } = await import("@/db");
  const { getOutreachLaneSummary } = await import("@/lib/outreach/queries");
  const t0 = performance.now();
  const s = await getOutreachLaneSummary(db, [hiringKey], []);
  console.log(`summary hiring=${s.hiring} ready=${s.readyForEmail} sources=${JSON.stringify(s.sources)} ${Math.round(performance.now() - t0)}ms`);
  assert.equal(s.hiring - baseline.hiring, 4);
  assert.equal(s.readyForEmail - baseline.readyForEmail, readyAll.length);
  // hiringContactedVerified and plainContactedVerifiedBackfill carry status_backfill.
  assert.equal(s.sources.backfill - baseline.sources.backfill, 2);
  assert.equal(s.sources.emailSent - baseline.sources.emailSent, 1);
  assert.equal(s.sources.linkedin - baseline.sources.linkedin, 1);

  const hidden = await getOutreachLaneSummary(db, [hiringKey], HIDDEN as never);
  assert.equal(hidden.readyForEmail - baseline.readyForEmail, readyAll.length - 1);
  assert.equal(hidden.hiring - baseline.hiring, 3);
});

test("an empty hiring key list gives a hiring count of 0 and does not break the ready count", async () => {
  const { db } = await import("@/db");
  const { getOutreachLaneSummary } = await import("@/lib/outreach/queries");
  const s = await getOutreachLaneSummary(db, [], []);
  assert.equal(s.hiring, 0);
  assert.equal(s.readyForEmail - baseline.readyForEmail, readyAll.length);
});

test("lane badges are UNFILTERED lane sizes: a name search and a posting filter move the table total, never the summary", async () => {
  const plain = await lane("hiring");
  const narrowed = await lane("hiring", { filters: { name: `${lastName}x`, market: "latam" } });
  assert.equal(narrowed.page.total, 0);
  assert.equal(narrowed.page.laneSummary.hiring, plain.page.laneSummary.hiring);
  assert.equal(narrowed.page.laneSummary.readyForEmail, plain.page.laneSummary.readyForEmail);
});
