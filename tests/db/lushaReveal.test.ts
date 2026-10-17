/**
 * DB-backed tests for the Lusha ledger (lusha-reveal PR 4, plus the PR 5 orchestration at the end): the advisory-locked reservation, the settles, the
 * duplicate enqueue and the merge repoint. Opt-in and fail-closed like the other files here: `npm run test:db`,
 * DATABASE_URL pointing at a local database whose name ends in `_e2e` that has migration 0043. NEVER calls Lusha:
 * the HTTP step is simulated by handing the settles hand-built bodies. Rows are created under a per-run token and
 * removed afterwards. The cap is global, so every cap test is relative to the day's spend measured at that moment.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
let bdId: string;
const personIds: string[] = [];

async function mkPerson(name: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, ...over }).returning();
  personIds.push(p.id);
  return p;
}

const personRow = async (id: string) => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(person).where(eq(person.id, id)))[0];
};

const ledger = async (personId: string) => {
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(lushaReveal).where(eq(lushaReveal.personId, personId));
};

/** Search reserved, settled as matched with the given price list. */
async function matchedSearch(personId: string, canReveal = [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }]) {
  const { reserve, settleSearch } = await import("@/lib/lusha/revealDb");
  const r = await reserve({ personId, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  await settleSearch({ reservationId: r.reservationId, outcome: "matched", creditsCharged: 1, lushaContactId: "lu-1", payload: { canReveal } });
  return r.reservationId;
}

before(async () => {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Lusha", email: `zz-lusha-${run}@example.test`, lushaEnabled: true }).returning();
  bdId = b.id;
});

after(async () => {
  const { db } = await import("@/db");
  const { auditLog, bd, person } = await import("@/db/schema");
  const { inArray, eq } = await import("drizzle-orm");
  await db.delete(auditLog).where(inArray(auditLog.personId, personIds));
  await db.delete(person).where(inArray(person.id, personIds)); // cascades ledger, activity, history, candidates, merge events
  await db.delete(bd).where(eq(bd.id, bdId));
});

test("two concurrent reserve() on the same (person, field) leave exactly one row: a double click is busy", async () => {
  const { reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("dbl");
  const out = await Promise.all([1, 2].map(() => reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000 })));
  assert.deepEqual(out.map((r) => r.ok).sort(), [false, true]);
  assert.ok(out.some((r) => !r.ok && r.reason === "busy"));
  assert.equal((await ledger(p.id)).length, 1);
});

test("concurrent reservations from different Contacts cannot exceed the cap", async () => {
  const { getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const people = await Promise.all(["a", "b", "c", "d", "e"].map((n) => mkPerson(`cap-${n}`)));
  const cap = (await getDailySpend()) + 2;
  const out = await Promise.all(people.map((p) => reserve({ personId: p.id, field: "search", actorBdId: bdId, cap })));
  assert.equal(out.filter((r) => r.ok).length, 2, "exactly the two credits of headroom were handed out");
  assert.ok(out.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "cap_exceeded"));
  assert.equal(await getDailySpend(), cap);
});

test("a failed row does not block a later reserve, and its reserved amount keeps counting", async () => {
  const { failReservation, getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("fail");
  const before = await getDailySpend();
  const first = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(first.ok);
  await failReservation(first.reservationId, "unavailable");
  assert.equal(await getDailySpend(), before + 1, "failed keeps the reservation counting");
  const second = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(second.ok, "failed is outside the in-flight index");
  const [failed] = (await ledger(p.id)).filter((r) => r.state === "failed");
  assert.equal(failed.creditsCharged, null);
  assert.equal(failed.errorCode, "unavailable");
});

test("outcome_unknown on a reveal keeps the reserved 5 credits counting", async () => {
  const { failReservation, getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("unknown");
  await matchedSearch(p.id);
  const before = await getDailySpend();
  const r = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok && r.credits === 5);
  await failReservation(r.reservationId, "outcome_unknown");
  assert.equal(await getDailySpend(), before + 5);
});

test("the reveal price is re-read at reservation: a stored 0 reserves one credit and obeys the cap", async () => {
  const { getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("zero");
  await matchedSearch(p.id, [{ field: "emails", credits: 0 }]);
  const spent = await getDailySpend();
  const refused = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: spent });
  assert.deepEqual(refused.ok, false);
  const ok = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: spent + 1 });
  assert.ok(ok.ok && ok.credits === 1);
});

test("a reveal needs a settled matched search: a rejected one (rejected meanwhile) is refused", async () => {
  const { rejectMatch, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("rej");
  const searchId = await matchedSearch(p.id);
  assert.equal(await rejectMatch(p.id, bdId), true);
  const [row] = (await ledger(p.id)).filter((r) => r.id === searchId);
  assert.equal(row.outcome, "match_rejected");
  assert.equal(row.creditsCharged, 1, "rejecting never touches the charge (D5)");
  assert.equal(row.rejectedByBdId, bdId);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual(r.ok === false && r.reason, "no_search");
  assert.equal(await rejectMatch(p.id, bdId), false, "only a matched search can be rejected");
});

test("an email reveal settles ledger, person, history and activity together and is served from the ledger afterwards", async () => {
  const { getRevealState, reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const { db } = await import("@/db");
  const { activity, personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { isReachable } = await import("@/lib/sequences/rosterGuards");
  const p = await mkPerson("rev", { emailSource: "pattern_inferred", email: `guess-${run}@acme.test`, emailNormalized: `guess-${run}@acme.test`, emailStatus: "probable" });
  const searchId = await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const email = `Real-${run}@Acme.test`;
  const out = await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "emails", emails: [{ email, confidence: 70 }], creditsCharged: 1 });
  assert.deepEqual([out?.outcome, out?.written, out?.duplicate, out?.writeFailed], ["revealed", "email", null, false]);
  const after = await personRow(p.id);
  assert.deepEqual([after.email, after.emailNormalized, after.emailStatus, after.emailSource, after.emailConfidence], [email, email.toLowerCase(), "probable", "lusha", 70]);
  assert.equal(isReachable({ personId: p.id, email: after.email, emailStatus: after.emailStatus, emailSource: after.emailSource, mergedIntoId: null, companyKey: null, clientStatus: null }), true);
  const history = await db.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, p.id));
  assert.ok(history.length >= 2 && history.every((h) => h.source === "lusha_reveal"));
  const acts = (await db.select().from(activity).where(eq(activity.personId, p.id))).filter((a) => a.type === "lusha_reveal");
  assert.deepEqual(acts.map((a) => [a.actorBdId, a.metadata]), [[bdId, { field: "emails", creditsCharged: 1, lushaId: "lu-1" }]]);
  const row = (await ledger(p.id)).find((l) => l.field === "emails")!;
  assert.deepEqual([row.state, row.outcome, row.creditsCharged, row.searchId, row.valueNormalized], ["settled", "revealed", 1, searchId, email.toLowerCase()]);
  const state = await getRevealState(p.id);
  assert.equal(state.search?.id, searchId);
  assert.equal(state.emails?.outcome, "revealed");
  assert.equal(await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "emails", emails: [], creditsCharged: 0 }), null, "a settled reservation cannot settle again");
});

test("a settle whose Contact write fails leaves no person write and keeps the paid value on the ledger", async () => {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("rollback");
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const out = await settleReveal({ reservationId: r.reservationId, actorBdId: randomUUID(), field: "emails", emails: [{ email: `rb-${run}@acme.test` }], creditsCharged: 1 });
  assert.equal(out?.writeFailed, true);
  const after = await personRow(p.id);
  assert.deepEqual([after.email, after.emailSource], [null, null]);
  const row = (await ledger(p.id)).find((l) => l.field === "emails")!;
  assert.deepEqual([row.state, row.outcome, row.value, row.errorCode], ["settled", "revealed", `rb-${run}@acme.test`, "write_failed"]);
  const cause = (row.payload as { writeError?: { message?: string } }).writeError;
  assert.ok(cause?.message, "the cause of the failed write is recorded, not swallowed");
});

test("a duplicate email is stored, enqueued as a candidate (pair ordered) and named; a merged-away holder is ignored", async () => {
  const { db } = await import("@/db");
  const { duplicateCandidate } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const email = `dup-${run}@acme.test`;
  const holder = await mkPerson("holder", { email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo" });
  const gone = await mkPerson("gone", { email: `gone-${run}@acme.test`, emailNormalized: `gone-${run}@acme.test`, mergedIntoId: holder.id });
  const p = await mkPerson("dupr");
  const q = await mkPerson("dupq");
  await matchedSearch(p.id);
  await matchedSearch(q.id);
  const rp = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  const rq = await reserve({ personId: q.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(rp.ok && rq.ok);
  const out = await settleReveal({ reservationId: rp.reservationId, actorBdId: bdId, field: "emails", emails: [{ email: email.toUpperCase() }], creditsCharged: 1 });
  assert.deepEqual([out?.duplicate?.personId, out?.duplicate?.name, out?.written], [holder.id, `holder ${run}`, "email"]);
  assert.equal((await personRow(p.id)).email, email.toUpperCase(), "the value is stored anyway");
  const [a, b] = [p.id, holder.id].sort();
  const rows = await db.select().from(duplicateCandidate).where(inArray(duplicateCandidate.personAId, [a]));
  const pair = rows.find((c) => c.personBId === b)!;
  assert.deepEqual([pair.reason, pair.matchKey, pair.status], ["lusha_reveal_email", email, "open"]);
  const clean = await settleReveal({ reservationId: rq.reservationId, actorBdId: bdId, field: "emails", emails: [{ email: `gone-${run}@acme.test` }], creditsCharged: 1 });
  assert.equal(clean?.duplicate, null, "a merged-away holder is not a duplicate");
  void gone;
});

test("a revealed phone never overwrites; an unexpected phone shape writes nothing but settles the real charge", async () => {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const occupied = await mkPerson("ph1", { phone: "111 1111111", mobilePhone: "222 2222222" });
  const wrong = await mkPerson("ph2");
  const shape = [{ number: "+54 11 5555 5555", type: "mobile" }];
  const results = [];
  for (const [p, phones] of [[occupied, shape], [wrong, [{ phoneNumber: "+54 11 5555 5555" }]]] as const) {
    await matchedSearch(p.id);
    const r = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
    assert.ok(r.ok);
    results.push(await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "phones", phones, creditsCharged: 5 }));
  }
  assert.deepEqual([results[0]?.outcome, results[0]?.written], ["revealed", null]);
  assert.deepEqual([(await personRow(occupied.id)).phone, (await personRow(occupied.id)).mobilePhone], ["111 1111111", "222 2222222"]);
  assert.deepEqual([results[1]?.outcome, results[1]?.written], ["no_value", null]);
  const row = (await ledger(wrong.id)).find((l) => l.field === "phones")!;
  assert.deepEqual([row.creditsCharged, row.errorCode, row.payload], [5, "unparsable_value", { phones: [{ phoneNumber: "+54 11 5555 5555" }] }]);
});

test("merge repoints the ledger to the survivor; two in-flight rows for one field fail the loser's, and unmerge puts the rows back", async () => {
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { mergeContacts, unmergeContact } = await import("@/lib/identity/mergeDb");
  const { reserve } = await import("@/lib/lusha/revealDb");
  const survivor = await mkPerson("surv");
  const merged = await mkPerson("mrg");
  const s = await reserve({ personId: survivor.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  const m = await reserve({ personId: merged.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(s.ok && m.ok);
  const { mergeEventId } = await mergeContacts(db, survivor.id, merged.id, "test", bdId);
  const after = await db.select().from(lushaReveal).where(inArray(lushaReveal.id, [s.reservationId, m.reservationId]));
  assert.ok(after.every((r) => r.personId === survivor.id), "both rows follow the Contact");
  const loser = after.find((r) => r.id === m.reservationId)!;
  assert.deepEqual([loser.state, loser.errorCode, loser.creditsReserved], ["failed", "merge_collision", 1]);
  assert.equal(after.find((r) => r.id === s.reservationId)!.state, "reserved");
  await unmergeContact(db, mergeEventId, bdId);
  const back = await db.select().from(lushaReveal).where(eq(lushaReveal.id, m.reservationId));
  assert.equal(back[0].personId, merged.id);
  assert.equal((await db.select().from(lushaReveal).where(eq(lushaReveal.id, s.reservationId)))[0].personId, survivor.id);
});

test("the daily spend window follows the Argentina day: a row reserved at 23:30 ART counts that day only", async () => {
  const { getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("day");
  const lateThen = new Date("2031-03-10T02:30:00.000Z"); // 23:30 ART on the 9th
  const earlyNext = new Date("2031-03-10T03:30:00.000Z"); // 00:30 ART on the 10th
  assert.equal(await getDailySpend(lateThen), 0);
  const r = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000, now: lateThen });
  assert.ok(r.ok);
  assert.equal(await getDailySpend(lateThen), 1);
  assert.equal(await getDailySpend(earlyNext), 0, "the next ART day starts empty");
});

async function revealEmail(personId: string, email: string) {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const r = await reserve({ personId, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  return settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "emails", emails: [{ email }], creditsCharged: 1 });
}

test("a value we already own is never paid for twice, even after a re-search (W2)", async () => {
  const { getDailySpend, getRevealState, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("twice");
  await matchedSearch(p.id);
  await revealEmail(p.id, `twice-${run}@acme.test`);
  await matchedSearch(p.id); // a newer search
  const spent = await getDailySpend();
  const again = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual(again.ok === false && again.reason, "already_revealed");
  assert.equal(await getDailySpend(), spent, "nothing was reserved");
  assert.equal((await getRevealState(p.id)).emails?.outcome, "revealed", "the older search's paid row still wins on the reader (W3)");
  const phone = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(phone.ok, "the other field is unaffected");
});

test("after a merge the survivor's newer search does not hide a paid reveal of the merged side (W3)", async () => {
  const { db } = await import("@/db");
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { getRevealState, reserve } = await import("@/lib/lusha/revealDb");
  const merged = await mkPerson("w3m");
  await matchedSearch(merged.id);
  await revealEmail(merged.id, `w3-${run}@acme.test`);
  const survivor = await mkPerson("w3s");
  await matchedSearch(survivor.id); // newer than the merged side's search
  await mergeContacts(db, survivor.id, merged.id, "test", bdId);
  assert.equal((await getRevealState(survivor.id)).emails?.value, `w3-${run}@acme.test`);
  const r = await reserve({ personId: survivor.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual(r.ok === false && r.reason, "already_revealed");
});

test("reserve refuses a merged-away or missing Contact, and waits for a merge that holds the person row (W1)", async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { mergeContacts } = await import("@/lib/identity/mergeDb");
  const { reserve } = await import("@/lib/lusha/revealDb");
  const survivor = await mkPerson("w1s");
  const merged = await mkPerson("w1m");
  await mergeContacts(db, survivor.id, merged.id, "test", bdId);
  const gone = await reserve({ personId: merged.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual(gone.ok === false && gone.reason, "merged");
  const missing = await reserve({ personId: randomUUID(), field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual(missing.ok === false && missing.reason, "not_found");

  const p = await mkPerson("w1wait");
  let settled = false;
  let pending!: ReturnType<typeof reserve>;
  await db.transaction(async (tx) => {
    await tx.select().from(person).where(eq(person.id, p.id)).for("update"); // what mergeContacts does
    pending = reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000 }).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(settled, false, "the reservation waits for the merge's row lock");
  });
  assert.ok((await pending).ok);
});

// --- PR 5: the orchestration through the REAL ports (fake fetch serving recorded fixtures: no network, no credit) ---
// Same file as the ledger tests on purpose: node:test runs files in parallel and the cap tests above read the
// day's global spend, which these would move.
const ENV = { VERCEL_ENV: "production", LUSHA_API_KEY: "sk-test-never-sent", LUSHA_DAILY_CREDIT_CAP: "1000000" };
const companyKeys: string[] = [];

const fixture = (name: string) => readFileSync(join(__dirname, "..", "unit", "fixtures", "lusha", name), "utf8");

/** A fetch that serves a fixture per endpoint and records every request. */
function fakeFetch(bodies: { search?: string; enrich?: string }) {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fn = async (url: string, init: RequestInit) => {
    requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const text = url.endsWith("/contacts/search") ? bodies.search : bodies.enrich;
    assert.ok(text, `unexpected request to ${url}`);
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fn, requests };
}

after(async () => {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (companyKeys.length) await db.delete(company).where(inArray(company.companyKey, companyKeys));
});

test("loadRevealSubject joins the company domain and rebuilds the LinkedIn URL from the profile key", async () => {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const { loadRevealSubject } = await import("@/lib/lusha/revealDb");
  const key = `zz-lusha-${run}`;
  companyKeys.push(key);
  await db.insert(company).values({ companyKey: key, displayName: "ZZ Co", domain: `zz-${run}.example.test` });
  const p = await mkPerson("act", { companyKey: key, profileKey: `linkedin.com/in/zz-${run}` });
  const s = await loadRevealSubject(p.id);
  assert.deepEqual([s?.companyDomain, s?.linkedinUrl], [`zz-${run}.example.test`, `https://linkedin.com/in/zz-${run}`]);
  assert.equal(await loadRevealSubject(randomUUID()), null);
});

test("search then reveal through the real ports: one search call, one enrich call, the value on the Contact, a repeat refused for free", async () => {
  const { db } = await import("@/db");
  const { activity, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { livePorts } = await import("@/lib/lusha/ports");
  const { revealLushaField, searchLushaContact } = await import("@/lib/lusha/reveal");
  const p = await mkPerson("act", { profileKey: `linkedin.com/in/e2e-${run}` });
  // The fixture answers for clientReferenceId "person-aaa"; point it at this Contact.
  const search = fixture("search-matched.json").replace("person-aaa", p.id);
  const fetchSpy = fakeFetch({ search, enrich: fixture("unverified-enrich-emails.json") });
  const ports = livePorts(ENV, fetchSpy.fn);

  const found = await searchLushaContact({ personId: p.id, field: "emails", actorBdId: bdId }, ports);
  assert.equal(found.ok && found.outcome, "matched");
  assert.equal(fetchSpy.requests.length, 1);

  const revealed = await revealLushaField({ personId: p.id, field: "emails", actorBdId: bdId, expect: { searchId: found.ok && found.outcome === "matched" ? found.searchId : "", price: 1 } }, ports);
  assert.equal(revealed.ok && revealed.outcome, "revealed");
  assert.equal(fetchSpy.requests.length, 2);
  assert.deepEqual(fetchSpy.requests[1].body, { ids: ["v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA"], reveal: ["emails"] });
  const [after] = await db.select().from(person).where(eq(person.id, p.id));
  assert.deepEqual([after.emailSource, after.emailStatus, after.email], ["lusha", "probable", "redacted-work@example.invalid"]);
  const acts = await db.select().from(activity).where(eq(activity.personId, p.id));
  assert.deepEqual(acts.map((a) => a.type), ["lusha_reveal"]);

  const again = await revealLushaField({ personId: p.id, field: "emails", actorBdId: bdId, expect: { searchId: "x", price: 1 } }, ports);
  // Now reachable, so the email is no longer offered at all: refused with no call and no charge.
  assert.deepEqual([again.ok, !again.ok && again.reason, fetchSpy.requests.length], [false, "lusha_not_eligible", 2]);
});

test("a 2xx with an unreadable body fails the reservation as outcome_unknown and keeps the reserved credits counting", async () => {
  const { getDailySpend } = await import("@/lib/lusha/revealDb");
  const { livePorts } = await import("@/lib/lusha/ports");
  const { searchLushaContact } = await import("@/lib/lusha/reveal");
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const p = await mkPerson("act", { profileKey: `linkedin.com/in/unk-${run}` });
  const before = await getDailySpend();
  const ports = livePorts(ENV, async () => new Response("<html>gateway</html>", { status: 200 }));
  const r = await searchLushaContact({ personId: p.id, field: "emails", actorBdId: bdId }, ports);
  assert.deepEqual([r.ok, !r.ok && r.reason, !r.ok && r.retryable], [false, "lusha_outcome_unknown", false]);
  const rows = await db.select().from(lushaReveal).where(eq(lushaReveal.personId, p.id));
  assert.deepEqual([rows[0].state, rows[0].errorCode, rows[0].creditsCharged], ["failed", "outcome_unknown", null]);
  assert.equal((await getDailySpend()) - before, 1);
});

test("the closed gate never reaches the client or the ledger", async () => {
  const { livePorts } = await import("@/lib/lusha/ports");
  const { revealLushaField } = await import("@/lib/lusha/reveal");
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const p = await mkPerson("act");
  const spy = fakeFetch({});
  const r = await revealLushaField({ personId: p.id, field: "emails", actorBdId: bdId, expect: { searchId: "x", price: 1 } }, livePorts({}, spy.fn));
  assert.deepEqual([r.ok, !r.ok && r.reason, spy.requests.length], [false, "lusha_off", 0]);
  assert.equal((await db.select().from(lushaReveal).where(eq(lushaReveal.personId, p.id))).length, 0);
});

test("a paid phone equal to a held number settles as already_held: charge recorded, nothing written, no activity", async () => {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const p = await mkPerson("held", { phone: "+54 11 5555 5555" });
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const out = await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "phones", phones: [{ number: "541155555555", type: "mobile" }], creditsCharged: 5 });
  assert.deepEqual([out?.outcome, out?.written, out?.writeFailed], ["already_held", null, false]);
  const [row] = (await ledger(p.id)).filter((x) => x.field === "phones");
  assert.deepEqual([row.outcome, row.errorCode, row.creditsCharged, row.state], ["already_held", "phone_already_held", 5, "settled"]);
  const after = await personRow(p.id);
  assert.deepEqual([after.phone, after.mobilePhone], ["+54 11 5555 5555", null]);
  assert.equal((await db.select().from(activity).where(eq(activity.personId, p.id))).length, 0);
});

test("one phones reveal with a work and a mobile number fills both columns: one history row each, one ledger row, one activity", async () => {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const { db } = await import("@/db");
  const { activity, personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const p = await mkPerson("both");
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const phones = [{ number: "+54 9 11 5000 0002", type: "mobile", doNotCall: true }, { number: "+54 11 4000 0001", type: "work" }];
  const out = await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "phones", phones, creditsCharged: 5 });
  assert.deepEqual([out?.outcome, out?.value, out?.writeFailed], ["revealed", "+54 11 4000 0001", false]);
  const after = await personRow(p.id);
  assert.deepEqual([after.phone, after.mobilePhone], ["+54 11 4000 0001", "+54 9 11 5000 0002"]);
  const history = (await db.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, p.id))).filter((h) => h.source === "lusha_reveal");
  assert.deepEqual(history.map((h) => h.property).sort(), ["mobilePhone", "phone"]);
  assert.equal((await db.select().from(activity).where(eq(activity.personId, p.id))).length, 1);
  const rows = (await ledger(p.id)).filter((x) => x.field === "phones");
  assert.deepEqual([rows.length, rows[0].creditsCharged, rows[0].payload], [1, 5, { phones }]);
});

test("a stored phones reveal that failed to write applies BOTH numbers with no second charge", async () => {
  const { reserve, settleReveal, applyStoredReveal } = await import("@/lib/lusha/revealDb");
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const p = await mkPerson("stored");
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "phones", phones: [{ number: "+54 11 4000 0001", type: "work" }, { number: "+54 9 11 5000 0002", type: "mobile" }], creditsCharged: 5 });
  // Park it as a failed write, then clear the columns the first write filled.
  const { person } = await import("@/db/schema");
  await db.update(lushaReveal).set({ errorCode: "write_failed" }).where(eq(lushaReveal.id, r.reservationId));
  await db.update(person).set({ phone: null, mobilePhone: null }).where(eq(person.id, p.id));
  const applied = await applyStoredReveal({ personId: p.id, field: "phones", actorBdId: bdId });
  assert.equal(applied.ok, true);
  const after = await personRow(p.id);
  assert.deepEqual([after.phone, after.mobilePhone], ["+54 11 4000 0001", "+54 9 11 5000 0002"]);
  assert.equal((await ledger(p.id)).find((x) => x.field === "phones")!.creditsCharged, 5);
});

test("failReservation can keep a paid raw value on the row, merged into the payload", async () => {
  const { failReservation, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("keep");
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  assert.equal(await failReservation(r.reservationId, "settle_failed", { emails: [{ email: `k-${run}@x.test` }], creditsCharged: 1 }), true);
  const [row] = (await ledger(p.id)).filter((x) => x.field === "emails");
  assert.deepEqual([row.state, row.errorCode, row.creditsCharged], ["failed", "settle_failed", null]);
  assert.deepEqual((row.payload as { emails: unknown[] }).emails, [{ email: `k-${run}@x.test` }]);
});

// --- PR 6, task 6.11: recovery from write_failed with no Lusha call ------------------------------

/** A paid email whose Contact write failed (a bad actor id makes the savepoint roll back), then the stored value is applied. */
async function paidButUnwritten(name: string, personOver: Record<string, unknown> = {}) {
  const { reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson(name, personOver);
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const email = `Apply-${name}-${run}@Acme.test`;
  const out = await settleReveal({ reservationId: r.reservationId, actorBdId: randomUUID(), field: "emails", emails: [{ email, confidence: 80 }], creditsCharged: 1 });
  assert.equal(out?.writeFailed, true);
  return { p, email };
}

test("applying a stored value writes the Contact once, clears the error, adds no spend, and a second call is refused", async () => {
  const { applyStoredReveal, getDailySpend } = await import("@/lib/lusha/revealDb");
  const { db } = await import("@/db");
  const { activity, personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { p, email } = await paidButUnwritten("apply");
  const spentBefore = await getDailySpend();
  const rowsBefore = await ledger(p.id);
  const out = await applyStoredReveal({ personId: p.id, field: "emails", actorBdId: bdId });
  assert.deepEqual([out.ok, out.ok && out.written, out.ok && out.value], [true, "email", email]);
  const after = await personRow(p.id);
  assert.deepEqual([after.email, after.emailNormalized, after.emailStatus, after.emailSource], [email, email.toLowerCase(), "probable", "lusha"]);
  assert.ok((await db.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, p.id))).some((h) => h.property === "email" && h.source === "lusha_reveal"));
  assert.equal((await db.select().from(activity).where(eq(activity.personId, p.id))).filter((a) => a.type === "lusha_reveal").length, 1);
  const rows = await ledger(p.id);
  assert.equal(rows.length, rowsBefore.length, "no reservation was created");
  const row = rows.find((l) => l.field === "emails")!;
  assert.deepEqual([row.errorCode, row.creditsCharged, row.state, row.outcome], [null, 1, "settled", "revealed"]);
  assert.equal("writeError" in (row.payload as object), false);
  assert.equal(await getDailySpend(), spentBefore, "applying a stored value adds nothing to the day's spend");
  const again = await applyStoredReveal({ personId: p.id, field: "emails", actorBdId: bdId });
  assert.deepEqual([again.ok, !again.ok && again.reason], [false, "not_applicable"]);
});

test("applying refuses a row that never failed to write, and records a duplicate holder", async () => {
  const { applyStoredReveal, reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const clean = await mkPerson("clean");
  await matchedSearch(clean.id);
  const r = await reserve({ personId: clean.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "emails", emails: [{ email: `clean-${run}@acme.test` }], creditsCharged: 1 });
  assert.deepEqual((await applyStoredReveal({ personId: clean.id, field: "emails", actorBdId: bdId })).ok, false);
  const nothing = await mkPerson("nothing");
  assert.deepEqual((await applyStoredReveal({ personId: nothing.id, field: "phones", actorBdId: bdId })).ok, false);
  const { p, email } = await paidButUnwritten("dupe");
  const holder = await mkPerson("holder", { email, emailNormalized: email.toLowerCase(), emailStatus: "verified" });
  const out = await applyStoredReveal({ personId: p.id, field: "emails", actorBdId: bdId });
  assert.deepEqual([out.ok, out.ok && out.duplicate?.personId], [true, holder.id]);
});

test("getRevealState also returns who paid, when it settled and the live holder of a duplicate email, in the same read", async () => {
  const { getRevealState, reserve, settleReveal } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("meta");
  await matchedSearch(p.id);
  const email = `meta-${run}@acme.test`;
  const holder = await mkPerson("metaholder", { email, emailNormalized: email, emailStatus: "verified" });
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  await settleReveal({ reservationId: r.reservationId, actorBdId: bdId, field: "emails", emails: [{ email }], creditsCharged: 1 });
  const state = await getRevealState(p.id);
  assert.equal(state.emails?.actorName, "ZZ Lusha");
  assert.ok(state.emails?.settledAt instanceof Date);
  assert.deepEqual(state.emails?.twin, { id: holder.id, name: `metaholder ${run}` });
  assert.equal(state.search?.twin ?? null, null);
});

// --- review fixes: a failed search never hides the settled one; a parked paid value is never bought again --------

test("a failed search after a settled match leaves the match, its field rows and the reveal intact", async () => {
  const { failReservation, getRevealState, rejectMatch, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("hide");
  const searchId = await matchedSearch(p.id);
  const unknown = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(unknown.ok);
  await failReservation(unknown.reservationId, "outcome_unknown");
  const failedSearch = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(failedSearch.ok);
  await failReservation(failedSearch.reservationId, "rate_limited");
  const state = await getRevealState(p.id);
  assert.deepEqual([state.search?.id, state.search?.outcome, state.phones?.errorCode], [searchId, "matched", "outcome_unknown"]);
  const again = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.deepEqual([again.ok, again.ok && again.searchId], [true, searchId], "reserve reads the same settled search");
  assert.equal(await rejectMatch(p.id, bdId), true, "reject targets the settled match, not the failed attempt");
});

test("a paid value parked by a failed settle blocks a second purchase and is applied for free", async () => {
  const { applyStoredReveal, failReservation, getRevealState, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("parked");
  await matchedSearch(p.id);
  const r = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 });
  assert.ok(r.ok);
  const email = `parked-${run}@acme.test`;
  await failReservation(r.reservationId, "settle_failed", { emails: [{ email, confidence: 60 }], creditsCharged: 1 });
  assert.equal((await getRevealState(p.id)).emails?.errorCode, "settle_failed");
  assert.deepEqual((await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: 1_000_000 })).ok, false, "never bought twice");
  const out = await applyStoredReveal({ personId: p.id, field: "emails", actorBdId: bdId });
  assert.deepEqual([out.ok, out.ok && out.written], [true, "email"]);
  const [row] = (await ledger(p.id)).filter((x) => x.field === "emails");
  assert.deepEqual([row.state, row.outcome, row.creditsCharged, row.errorCode, row.value], ["settled", "revealed", 1, null, email]);
  assert.equal((await personRow(p.id)).email, email);
});

// --- reaping stranded reservations; failed searches are refillable ------------------------------------------------

const MIN = 60_000;
const BIG = 1_000_000;

test("a reservation older than the threshold is reaped: failed, credits still counted, and the person is reservable again", async () => {
  const { STRANDED_AFTER_MS, getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("reap");
  const old = new Date(Date.now() - STRANDED_AFTER_MS - MIN);
  const stuck = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG, now: old });
  assert.ok(stuck.ok);
  assert.deepEqual((await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG, now: new Date(old.getTime() + MIN) })).ok, false, "still in flight at that moment");
  const again = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG });
  assert.ok(again.ok, "reaped, so no longer busy");
  const [reaped] = (await ledger(p.id)).filter((r) => r.id === stuck.reservationId);
  assert.deepEqual([reaped.state, reaped.errorCode, reaped.creditsReserved, reaped.creditsCharged, reaped.settledAt instanceof Date], ["failed", "reaped", 1, null, true]);
  assert.ok((await getDailySpend(old)) >= 1, "the reaped credit still counts in its own day");
});

test("a reservation inside the window may be in flight and is left alone", async () => {
  const { STRANDED_AFTER_MS, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("fresh");
  const first = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG, now: new Date(Date.now() - STRANDED_AFTER_MS + MIN) });
  assert.ok(first.ok);
  const second = await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG });
  assert.deepEqual(second.ok === false && second.reason, "busy");
  assert.equal((await ledger(p.id)).filter((r) => r.id === (first.ok ? first.reservationId : "")).map((r) => r.state)[0], "reserved");
});

test("two concurrent reserves over one stranded row: one wins, the other is busy, and the winner's fresh row is never reaped", async () => {
  const { STRANDED_AFTER_MS, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("reaprace");
  await reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG, now: new Date(Date.now() - STRANDED_AFTER_MS - MIN) });
  const out = await Promise.all([1, 2].map(() => reserve({ personId: p.id, field: "search", actorBdId: bdId, cap: BIG })));
  assert.deepEqual(out.map((r) => r.ok).sort(), [false, true]);
  const rows = await ledger(p.id);
  assert.deepEqual(rows.map((r) => r.state).sort(), ["failed", "reserved"]);
});

test("a stranded REVEAL reservation is reaped and then REFUSED, never re-claimed: the paid call may already have been billed", async () => {
  const { STRANDED_AFTER_MS, getDailySpend, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("reapreveal");
  await matchedSearch(p.id);
  const old = new Date(Date.now() - STRANDED_AFTER_MS - MIN);
  const stuck = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: BIG, now: old });
  assert.ok(stuck.ok && stuck.credits === 5);
  const again = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: BIG });
  assert.deepEqual(again.ok === false && again.reason, "outcome_unknown");
  const rows = (await ledger(p.id)).filter((r) => r.field === "phones");
  assert.deepEqual(rows.map((r) => [r.state, r.errorCode, r.creditsReserved]), [["failed", "reaped", 5]], "reaped and counted, and no second reservation was written");
  assert.ok((await getDailySpend(old)) >= 5);
});

test("reaping a row of another field or person does not refuse a reveal of this one", async () => {
  const { STRANDED_AFTER_MS, reserve } = await import("@/lib/lusha/revealDb");
  const [a, b] = [await mkPerson("reap-a"), await mkPerson("reap-b")];
  await matchedSearch(b.id);
  await reserve({ personId: a.id, field: "search", actorBdId: bdId, cap: BIG, now: new Date(Date.now() - STRANDED_AFTER_MS - MIN) });
  const r = await reserve({ personId: b.id, field: "emails", actorBdId: bdId, cap: BIG });
  assert.ok(r.ok, "only the target (person, field) refuses");
});

// --- the refusal decides from STATE read inside the lock, never from "I reaped it" -------------------------------------------

test("INTERLEAVING: another reserve reaps the stranded reveal row first; this reserve still refuses, because the state says unknown", async () => {
  const { STRANDED_AFTER_MS, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("interleave");
  await matchedSearch(p.id);
  const stuck = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: BIG, now: new Date(Date.now() - STRANDED_AFTER_MS - MIN) });
  assert.ok(stuck.ok);
  // Someone else's reserve takes the lock after the threshold and sweeps the row (the sweep is global): it is not ours.
  const other = await mkPerson("interleave-other");
  assert.ok((await reserve({ personId: other.id, field: "search", actorBdId: bdId, cap: BIG })).ok);
  assert.equal((await ledger(p.id)).find((r) => r.id === stuck.reservationId)?.errorCode, "reaped", "the other call did the reaping");
  // Our reserve reaps nothing itself, yet must refuse: a paid call may already be billed.
  const mine = await reserve({ personId: p.id, field: "phones", actorBdId: bdId, cap: BIG });
  assert.deepEqual(mine.ok === false && mine.reason, "outcome_unknown");
  assert.equal((await ledger(p.id)).filter((r) => r.field === "phones").length, 1, "no second reservation was written");
});

test("the same hole before any reaper: a reveal that timed out between prepare() and reserve() is refused for the same search", async () => {
  const { failReservation, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("unknown-between");
  await matchedSearch(p.id);
  const first = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG });
  assert.ok(first.ok);
  await failReservation(first.reservationId, "outcome_unknown");
  const second = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG });
  assert.deepEqual(second.ok === false && second.reason, "outcome_unknown");
});

test("an explicit NEW search reopens the field: the unknown outcome belonged to the old search", async () => {
  const { failReservation, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("reopen");
  await matchedSearch(p.id);
  const first = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG });
  assert.ok(first.ok);
  await failReservation(first.reservationId, "outcome_unknown");
  assert.equal((await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG })).ok, false);
  await matchedSearch(p.id); // a conscious, paid re-search: a new search id
  assert.equal((await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG })).ok, true);
});

test("a failure that is NOT an unknown outcome never blocks a later reveal", async () => {
  const { failReservation, reserve } = await import("@/lib/lusha/revealDb");
  const p = await mkPerson("plainfail");
  await matchedSearch(p.id);
  const first = await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG });
  assert.ok(first.ok);
  await failReservation(first.reservationId, "rate_limited");
  assert.equal((await reserve({ personId: p.id, field: "emails", actorBdId: bdId, cap: BIG })).ok, true);
});

// --- the contacts list: ONE query says which listed Contacts hold a flagged number ---------------------------------------------

test("flaggedPhonePersonIds resolves a whole page in one call and flags only a number that is still the one the list shows", async () => {
  const { flaggedPhonePersonIds } = await import("@/lib/lusha/doNotCallDb");
  const { db } = await import("@/db");
  const { lushaReveal } = await import("@/db/schema");
  const NUM = "+54 9 11 3026-1031";
  const reveal = async (personId: string, phones: unknown[], over: Record<string, unknown> = {}) => {
    const search = await matchedSearch(personId);
    await db.insert(lushaReveal).values({ personId, searchId: search, field: "phones", state: "settled", outcome: "revealed", value: NUM, creditsReserved: 5, creditsCharged: 5, payload: { phones }, ...over });
  };
  const flagged = await mkPerson("dnc-flagged", { mobilePhone: NUM });
  const dup = await mkPerson("dnc-dup", { mobilePhone: NUM });
  const clear = await mkPerson("dnc-clear", { mobilePhone: NUM });
  const edited = await mkPerson("dnc-edited", { mobilePhone: "+54 9 11 5555-0000" });
  const otherCol = await mkPerson("dnc-other", { phone: "+54 11 4000-0001", mobilePhone: NUM });
  const failedRow = await mkPerson("dnc-failed", { mobilePhone: NUM });
  await reveal(flagged.id, [{ number: NUM, doNotCall: true }]);
  await reveal(dup.id, [{ number: NUM, doNotCall: false }, { number: "+5491130261031", doNotCall: true }]);
  await reveal(clear.id, [{ number: NUM, doNotCall: false }]);
  await reveal(edited.id, [{ number: NUM, doNotCall: true }]);
  await reveal(otherCol.id, [{ number: NUM, doNotCall: true }]);
  await reveal(failedRow.id, [{ number: NUM, doNotCall: true }], { state: "failed", outcome: null });
  const page = [flagged, dup, clear, edited, otherCol, failedRow].map((p) => ({ id: p.id, phone: p.phone, mobilePhone: p.mobilePhone }));
  const out = await flaggedPhonePersonIds(page);
  assert.deepEqual([...out].sort(), [flagged.id, dup.id].sort(), "edited-away, unflagged, a flag on the other column and a non-settled row are all excluded");
  assert.deepEqual([...(await flaggedPhonePersonIds([]))], []);
});
