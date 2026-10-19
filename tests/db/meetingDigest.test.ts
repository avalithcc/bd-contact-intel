/**
 * The 18:00 meetings email against a scratch database (migration 0054 applied): which BDs are selected from real rows with the
 * Argentina day boundaries, and that the (BD, day) claim makes the send idempotent. Never sends mail. Opt-in and fail-closed:
 * `npm run test:db`, DATABASE_URL a local `_e2e` database. Every test runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");
type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

const NOW = new Date("2026-10-22T21:00:00.000Z"); // 18:00 ART on Thu 22 Oct 2026
const art = (date: string, time: string) => new Date(`${date}T${time}:00.000-03:00`);

async function seed(tx: Tx) {
  const { bd, person } = await import("@/db/schema");
  const [a] = await tx.insert(bd).values({ email: "zz-digest-a@example.test", name: "ZZ Digest A" }).returning();
  const [b] = await tx.insert(bd).values({ email: "zz-digest-b@example.test", name: "ZZ Digest B" }).returning();
  const [c] = await tx.insert(bd).values({ email: "zz-digest-c@example.test", name: "ZZ Digest C" }).returning();
  const [p] = await tx.insert(person).values({ firstName: "Lucía", lastName: "Fernández", company: "Andes Labs" }).returning();
  return { a: a!, b: b!, c: c!, contact: p! };
}

async function addMeeting(tx: Tx, personId: string, bdId: string, at: Date, status = "scheduled") {
  const { meeting } = await import("@/db/schema");
  await tx.insert(meeting).values({ personId, bdId, scheduledAt: at, status });
}

test("selection from real rows: today's unconfirmed meetings per BD, the Argentina midnight as the day boundary", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a, b, c, contact } = await seed(tx);
    // A: one early today (00:10 ART, 03:10Z), one yesterday just before midnight ART (02:50Z on the 22nd UTC).
    await addMeeting(tx, contact.id, a.id, art("2026-10-22", "00:10"));
    await addMeeting(tx, contact.id, a.id, art("2026-10-21", "23:50"));
    // B: only an older one, so no email. C: one today, one held (not unconfirmed), one still to come (18:30), one cancelled.
    await addMeeting(tx, contact.id, b.id, art("2026-10-20", "10:00"));
    await addMeeting(tx, contact.id, c.id, art("2026-10-22", "11:00"));
    await addMeeting(tx, contact.id, c.id, art("2026-10-22", "09:00"), "held");
    await addMeeting(tx, contact.id, c.id, art("2026-10-22", "18:30"));
    await addMeeting(tx, contact.id, c.id, art("2026-10-22", "10:00"), "cancelled");

    const { getTodayUnconfirmedMeetingsForDigest, getOlderUnconfirmedCounts } = await import("@/lib/meetings/digestQueries");
    const { selectMeetingDigests } = await import("@/lib/meetings/digest");
    const rows = (await getTodayUnconfirmedMeetingsForDigest(NOW, 5000, tx)).filter((r) => [a.id, b.id, c.id].includes(r.bdId));
    const plans = selectMeetingDigests(rows, NOW, await getOlderUnconfirmedCounts(NOW, tx));
    const byBd = new Map(plans.map((p) => [p.bdId, p]));
    assert.deepEqual([...byBd.keys()].sort(), [a.id, c.id].sort(), "B has nothing from today");
    assert.equal(byBd.get(a.id)!.today.length, 1);
    assert.equal(byBd.get(a.id)!.olderCount, 1);
    assert.equal(byBd.get(c.id)!.today.length, 1);
    assert.equal(byBd.get(c.id)!.olderCount, 0);
    assert.equal(byBd.get(a.id)!.today[0]!.company, "Andes Labs");
  });
});

test("a backlog of older pending meetings never crowds today's out of the read; older ones are counted per BD", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a, contact } = await seed(tx);
    for (let i = 0; i < 12; i++) await addMeeting(tx, contact.id, a.id, art("2026-10-10", `${String(8 + (i % 10)).padStart(2, "0")}:00`));
    await addMeeting(tx, contact.id, a.id, art("2026-10-22", "17:00"));
    const { getTodayUnconfirmedMeetingsForDigest, getOlderUnconfirmedCounts } = await import("@/lib/meetings/digestQueries");
    const { selectMeetingDigests } = await import("@/lib/meetings/digest");
    // A limit smaller than the backlog: an ASC read of everything would have returned only older rows.
    const today = (await getTodayUnconfirmedMeetingsForDigest(NOW, 5, tx)).filter((r) => r.bdId === a.id);
    assert.equal(today.length, 1);
    const older = await getOlderUnconfirmedCounts(NOW, tx);
    assert.equal(older.get(a.id), 12);
    const [plan] = selectMeetingDigests(today, NOW, older).filter((p) => p.bdId === a.id);
    assert.equal(plan?.today.length, 1);
    assert.equal(plan?.olderCount, 12);
  });
});

test("the claim is idempotent per BD per Argentina day; another day or another BD claims again", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a, b } = await seed(tx);
    const { claimMeetingDigest, markMeetingDigestSent, markMeetingDigestFailed } = await import("@/lib/meetings/digestQueries");
    // created_at is the transaction's now(), so the claims below use a clock close to the real one.
    const clock = new Date();
    const first = await claimMeetingDigest(a.id, "2026-10-22", clock, tx);
    assert.ok(first);
    assert.equal(await claimMeetingDigest(a.id, "2026-10-22", clock, tx), null, "a repeated run does not claim again");
    await markMeetingDigestSent(first!, { subject: "s", todayCount: 1, olderCount: 0 }, tx);
    assert.equal(await claimMeetingDigest(a.id, "2026-10-22", new Date(clock.getTime() + 3_600_000), tx), null, "a sent row is never resent");
    assert.ok(await claimMeetingDigest(a.id, "2026-10-23", clock, tx), "the next day is a new claim");
    const other = await claimMeetingDigest(b.id, "2026-10-22", clock, tx);
    assert.ok(other, "another BD claims the same day");
    await markMeetingDigestFailed(other!, "boom", tx);
    assert.equal(await claimMeetingDigest(b.id, "2026-10-22", new Date(clock.getTime() + 3_600_000), tx), null, "a failed row is left for a human");
  });
});

test("a pending claim whose run died is reclaimed only once it is old enough", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a } = await seed(tx);
    const { claimMeetingDigest } = await import("@/lib/meetings/digestQueries");
    const { ABANDONED_CLAIM_THRESHOLD_MS } = await import("@/lib/tasks/digestClaim");
    // created_at is the transaction's now(); ask from a clock that is later by less/more than the threshold.
    assert.ok(await claimMeetingDigest(a.id, "2026-10-22", new Date(), tx));
    assert.equal(await claimMeetingDigest(a.id, "2026-10-22", new Date(Date.now() + ABANDONED_CLAIM_THRESHOLD_MS - 60_000), tx), null, "still in progress");
    assert.ok(await claimMeetingDigest(a.id, "2026-10-22", new Date(Date.now() + ABANDONED_CLAIM_THRESHOLD_MS + 60_000), tx), "abandoned: reclaimed");
  });
});
