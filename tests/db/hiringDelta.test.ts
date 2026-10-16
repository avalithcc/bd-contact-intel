/**
 * DB-backed proof of the 7-day delta on the Vacantes screen (getCompanyHiringSummaries) = today's counted total
 * minus the total counted 7 days ago: a posting opened 3 days ago counts, one opened 10 days ago does not, a 2022 req
 * closing this week is NOT a "-1", a posting opened and closed inside the window nets to zero, and postings aging
 * out of the 30-day window without a closure show as a drop. Opt-in and fail-closed like the other files here (`npm run
 * test:db`, DATABASE_URL must name a `_e2e` database). Every row is created under a per-run token and removed after.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const companyKeys: string[] = [];
const bdIds: string[] = [];
// A BD with no contacts: the delta tests do not look at contactCount.
const anyBd = randomUUID();
// Margin around each boundary: today's total and the baseline are two statements, so now() moves between them.
const M = 5_000;
const ago = (days: number, offsetMs = 0) => new Date(Date.now() - days * 86_400_000 + offsetMs);

// `seen` defaults to `posted`; set it apart from `posted` to model "published long ago, scraped only now" and back.
type P = { posted: Date; closed?: Date; seen?: Date };

async function mk(name: string, postings: P[]) {
  const { db } = await import("@/db");
  const { company, jobPosting, targetCompany } = await import("@/db/schema");
  const ck = `zz-${run}-${name}`;
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  await db.insert(jobPosting).values(
    postings.map((p, i) => ({
      companyKey: ck, externalId: String(i), title: "Engineer", location: "Austin, TX", url: "https://example.test",
      isIt: true, market: "us", postedAt: p.posted, firstSeen: p.seen ?? p.posted, closedAt: p.closed ?? null,
    })),
  );
  return ck;
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, company, companyAlias, jobPosting, targetCompany } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds)); // contacts cascade
  if (companyKeys.length) {
    await db.delete(companyAlias).where(inArray(companyAlias.companyKey, companyKeys));
    await db.delete(jobPosting).where(inArray(jobPosting.companyKey, companyKeys));
    await db.delete(targetCompany).where(inArray(targetCompany.companyKey, companyKeys));
    await db.delete(company).where(inArray(company.companyKey, companyKeys));
  }
  await db.$client.end();
});

test("the 7-day delta is today's counted total minus the total counted a week ago", async () => {
  const { getCompanyHiringSummaries } = await import("@/lib/hiring/queries");
  const old = daysAgo(20);
  const keys = {
    opened3: await mk("opened3", [{ posted: old }, { posted: daysAgo(3) }]),
    opened10: await mk("opened10", [{ posted: old }, { posted: daysAgo(10) }]),
    allNew: await mk("allnew", [{ posted: daysAgo(2) }, { posted: daysAgo(5) }]),
    stale2022: await mk("stale2022", [{ posted: old }, { posted: new Date("2022-03-01"), closed: daysAgo(2) }]),
    closedReal: await mk("closedreal", [{ posted: old }, { posted: daysAgo(25), closed: daysAgo(2) }]),
    openedAndClosed: await mk("openedclosed", [{ posted: old }, { posted: daysAgo(4), closed: daysAgo(1) }]),
    // Three postings cross the 30-day line this week with no closure: 4 counted a week ago, 1 today.
    agedOut: await mk("agedout", [{ posted: daysAgo(34) }, { posted: daysAgo(33) }, { posted: daysAgo(32) }, { posted: daysAgo(10) }]),
  };

  const { summaries } = await getCompanyHiringSummaries(anyBd);
  const by = new Map(summaries.map((s) => [s.companyKey, s]));
  const d = (k: keyof typeof keys) => by.get(keys[k])!;

  assert.deepEqual(d("opened3").delta, { kind: "up", amount: 1 }, "opened 3 days ago counts");
  assert.deepEqual(d("opened10").delta, { kind: "none" }, "opened 10 days ago does not");
  assert.deepEqual(d("allNew").delta, { kind: "new" }, "nothing counted older than the window");
  assert.deepEqual(d("stale2022").delta, { kind: "none" }, "a 2022 req closing this week is not a -1");
  assert.deepEqual(d("closedReal").delta, { kind: "down", amount: 1 }, "a counted posting that closed is a -1");
  assert.deepEqual(d("openedAndClosed").delta, { kind: "none" }, "opened and closed in the window nets to zero");
  assert.deepEqual(d("agedOut").delta, { kind: "down", amount: 3 }, "postings aging out of the window are a drop");
  assert.equal(d("opened3").openItCount, 2);

  // Under a market filter "new on the radar" is suppressed: the same company reads as a plain rise.
  const filtered = await getCompanyHiringSummaries(anyBd, "us");
  assert.deepEqual(filtered.summaries.find((s) => s.companyKey === keys.allNew)!.delta, { kind: "up", amount: 2 });

  // Sorted by vacancies descending.
  const counts = summaries.map((s) => s.openItCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

// Each pair brackets one boundary by +-5s. The anchor (20 days, seen then) keeps the company in the table and in the
// baseline, so the assertion reads the delta of the probe alone.
test("the 7, 30 and 37 day boundaries behave as stated, not just in the SQL text", async () => {
  const { getCompanyHiringSummaries } = await import("@/lib/hiring/queries");
  const anchor = { posted: daysAgo(20) };
  const probe = (name: string, posted: Date) => mk(name, [anchor, { posted }]);
  const keys = {
    // 7 days: published just before the baseline instant is in it, just after is an opening.
    b7in: await probe("b7in", ago(7, -M)),
    b7out: await probe("b7out", ago(7, +M)),
    // 30 days: just inside still counts today, just outside has aged out (but counted a week ago).
    b30in: await probe("b30in", ago(30, +M)),
    b30out: await probe("b30out", ago(30, -M)),
    // 37 days: just inside counted a week ago (and has since aged out), just outside never did.
    b37in: await probe("b37in", ago(37, +M)),
    b37out: await probe("b37out", ago(37, -M)),
  };
  const { summaries } = await getCompanyHiringSummaries(anyBd);
  const delta = (k: keyof typeof keys) => summaries.find((s) => s.companyKey === keys[k])!.delta;
  assert.deepEqual(delta("b7in"), { kind: "none" });
  assert.deepEqual(delta("b7out"), { kind: "up", amount: 1 });
  assert.deepEqual(delta("b30in"), { kind: "none" });
  assert.deepEqual(delta("b30out"), { kind: "down", amount: 1 });
  assert.deepEqual(delta("b37in"), { kind: "down", amount: 1 });
  assert.deepEqual(delta("b37out"), { kind: "none" });
});

test("what we had not scraped a week ago was not in our total, whatever its publish date", async () => {
  const { getCompanyHiringSummaries } = await import("@/lib/hiring/queries");
  const keys = {
    // Published 15 days ago but first scraped yesterday: an opening for us, not part of the baseline.
    lateSeen: await mk("lateseen", [{ posted: daysAgo(20) }, { posted: daysAgo(15), seen: daysAgo(1) }]),
    // A company we just met whose postings are all older than a week: new on the radar, not "no change".
    lateCompany: await mk("latecompany", [{ posted: daysAgo(15), seen: daysAgo(1) }, { posted: daysAgo(12), seen: daysAgo(1) }]),
    // Opposite direction, the Greenhouse case: held for 20 days, then edited 3 days ago so posted_at (updated_at)
    // jumped forward. It did not open and did not close: no badge.
    editedOld: await mk("editedold", [{ posted: daysAgo(20) }, { posted: daysAgo(3), seen: daysAgo(20) }]),
  };
  const { summaries } = await getCompanyHiringSummaries(anyBd);
  const delta = (k: keyof typeof keys) => summaries.find((s) => s.companyKey === keys[k])!.delta;
  assert.deepEqual(delta("lateSeen"), { kind: "up", amount: 1 });
  assert.deepEqual(delta("lateCompany"), { kind: "new" });
  assert.deepEqual(delta("editedOld"), { kind: "none" });
});

test("the contact count is the signed-in BD's own, the same rows /?companyKey= lists", async () => {
  const { db } = await import("@/db");
  const { bd, contact } = await import("@/db/schema");
  const { getCompanyHiringSummaries } = await import("@/lib/hiring/queries");
  const { listContacts } = await import("@/lib/queries");
  const ck = await mk("contacts", [{ posted: daysAgo(20) }]);
  const { company, companyAlias } = await import("@/db/schema");
  // A contact keyed on an alias of the company must count, exactly as companyKeyFilter lists it.
  const aliasKey = `zz-${run}-contacts-alias`;
  await db.insert(company).values({ companyKey: aliasKey, displayName: aliasKey });
  companyKeys.push(aliasKey);
  await db.insert(companyAlias).values({ aliasKey, companyKey: ck });
  const [mine, theirs] = await db
    .insert(bd)
    .values([
      { name: "ZZ Mine", email: `zz-mine-${run}@example.test` },
      { name: "ZZ Theirs", email: `zz-theirs-${run}@example.test` },
    ])
    .returning();
  bdIds.push(mine.id, theirs.id);
  await db.insert(contact).values([
    { bdId: mine.id, profileKey: `a-${run}`, companyKey: ck },
    { bdId: mine.id, profileKey: `b-${run}`, companyKey: ck },
    { bdId: mine.id, profileKey: `d-${run}`, companyKey: aliasKey },
    { bdId: theirs.id, profileKey: `c-${run}`, companyKey: ck },
  ]);
  for (const [who, want] of [[mine, 3], [theirs, 1]] as const) {
    const row = (await getCompanyHiringSummaries(who.id)).summaries.find((s) => s.companyKey === ck)!;
    assert.equal(row.contactCount, want);
    assert.equal((await listContacts(who.id, { companyKey: ck })).total, want, "the link opens as many rows as the count says");
  }
});

// The owner clicks the number and lands on that company's hiring tab: both must be the same set, not merely close.
test("the number on the Vacantes table equals the total behind the company's hiring tab", async () => {
  const { getCompanyHiringSummaries, getCompanyPostingsForKey } = await import("@/lib/hiring/queries");
  const fresh = Array.from({ length: 105 }, (_, i) => ({ posted: daysAgo(1 + (i % 25)) }));
  const ck = await mk("clicked", [
    ...fresh,
    { posted: daysAgo(40) }, // aged out of the window
    { posted: daysAgo(5), closed: daysAgo(1) }, // closed
  ]);
  const row = (await getCompanyHiringSummaries(anyBd)).summaries.find((s) => s.companyKey === ck)!;
  const tab = (await getCompanyPostingsForKey(ck))!;
  assert.equal(row.openItCount, 105);
  assert.equal(tab.totalCount, row.openItCount, "same window, same total");
  // The tab lists a bounded page, so it must be able to say it is showing fewer than the total it opens onto.
  assert.ok(tab.postings.length < tab.totalCount);
});

test("under a market or Miami filter the table number equals the filtered total behind the tab", async () => {
  const { db } = await import("@/db");
  const { jobPosting, targetCompany, company } = await import("@/db/schema");
  const { getCompanyHiringSummaries, getCompanyPostingsForKey } = await import("@/lib/hiring/queries");
  const ck = `zz-${run}-filtered`;
  companyKeys.push(ck);
  await db.insert(company).values({ companyKey: ck, displayName: ck });
  await db.insert(targetCompany).values({ companyKey: ck, displayName: ck, ats: "lever", config: {} });
  const mkp = (i: number, market: string, isMiami = false, closedAt: Date | null = null) => ({
    companyKey: ck, externalId: `f${i}`, title: "Engineer", location: "x", url: "https://example.test",
    isIt: true, market, isMiami, postedAt: daysAgo(2), firstSeen: daysAgo(2), closedAt,
  });
  await db.insert(jobPosting).values([
    ...[0, 1, 2].map((i) => mkp(i, "us", true)),
    ...[3, 4].map((i) => mkp(i, "us")),
    ...[5, 6, 7, 8].map((i) => mkp(i, "latam")),
    mkp(9, "us", true, daysAgo(1)), // closed: counted by neither side
  ]);
  const cases = [
    { filter: {}, want: 9 },
    { filter: { market: "us" as const }, want: 5 },
    { filter: { market: "us" as const, miamiOnly: true }, want: 3 },
    { filter: { market: "latam" as const }, want: 4 },
  ];
  for (const { filter, want } of cases) {
    const row = (await getCompanyHiringSummaries(anyBd, filter.market, filter.miamiOnly)).summaries.find((s) => s.companyKey === ck)!;
    const tab = (await getCompanyPostingsForKey(ck, filter))!;
    assert.equal(row.openItCount, want, JSON.stringify(filter));
    assert.equal(tab.totalCount, row.openItCount, `tab agrees with the table under ${JSON.stringify(filter)}`);
    assert.equal(tab.postings.length, want);
  }
});

test("a Greenhouse edit cannot resurrect an aged-out posting, and a null posted_at falls back to first_seen", async () => {
  const { getCompanyHiringSummaries, getCompanyPostingsForKey } = await import("@/lib/hiring/queries");
  const { db } = await import("@/db");
  const { jobPosting } = await import("@/db/schema");
  const anchor = { posted: daysAgo(20) };
  // First seen 40 days ago, posted_at pushed to 3 days ago by an edit: never opened this week, aged out long ago.
  const edited = await mk("gh-edited", [anchor, { posted: daysAgo(3), seen: daysAgo(40) }]);
  // Same row shape but only 33 days old by first_seen: it WAS counted a week ago and has since aged out: a real drop.
  const agedAfterEdit = await mk("gh-aged", [anchor, { posted: daysAgo(3), seen: daysAgo(33) }]);
  const nullFresh = await mk("null-fresh", [anchor]);
  const nullStale = await mk("null-stale", [anchor]);
  await db.insert(jobPosting).values([
    { companyKey: nullFresh, externalId: "n", title: "E", location: "x", url: "https://example.test", isIt: true, market: "us", postedAt: null, firstSeen: daysAgo(5) },
    { companyKey: nullStale, externalId: "n", title: "E", location: "x", url: "https://example.test", isIt: true, market: "us", postedAt: null, firstSeen: daysAgo(40) },
  ]);
  const by = new Map((await getCompanyHiringSummaries(anyBd)).summaries.map((s) => [s.companyKey, s]));
  assert.equal(by.get(edited)!.openItCount, 1, "only the anchor counts");
  assert.deepEqual(by.get(edited)!.delta, { kind: "none" }, "no badge for an edited old posting");
  assert.equal((await getCompanyPostingsForKey(edited))!.totalCount, 1);
  assert.equal(by.get(agedAfterEdit)!.openItCount, 1);
  assert.deepEqual(by.get(agedAfterEdit)!.delta, { kind: "down", amount: 1 }, "it did age out this week");
  assert.equal(by.get(nullFresh)!.openItCount, 2, "null posted_at, first seen 5 days ago: counted");
  assert.equal(by.get(nullStale)!.openItCount, 1, "null posted_at, first seen 40 days ago: not counted");
});

test("\"new this week\" on the contact record is new to us (first_seen), so an edit does not make an old req new", async () => {
  const { getCompanyPostingsForKey } = await import("@/lib/hiring/queries");
  const anchor = { posted: daysAgo(20) };
  // Greenhouse shape: first seen 20 days ago, posted_at (updated_at) bumped to 2 days ago by an edit.
  const edited = await mk("new-edited", [anchor, { posted: daysAgo(2), seen: daysAgo(20) }]);
  // Genuinely new: published and first seen 2 days ago.
  const fresh = await mk("new-fresh", [anchor, { posted: daysAgo(2) }]);
  // Published 15 days ago but we only found it yesterday: new to us, matching the Vacantes delta.
  const lateSeen = await mk("new-late", [anchor, { posted: daysAgo(15), seen: daysAgo(1) }]);
  assert.equal((await getCompanyPostingsForKey(edited))!.newLast7DaysCount, 0);
  assert.equal((await getCompanyPostingsForKey(edited))!.totalCount, 2, "still counted as open and fresh");
  assert.equal((await getCompanyPostingsForKey(fresh))!.newLast7DaysCount, 1);
  assert.equal((await getCompanyPostingsForKey(lateSeen))!.newLast7DaysCount, 1);
});
