import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDITS_PER_CONTACT, contactsWithinCredits, evaluateCap, evaluateCaps, planReservation, type CapsInput } from "../../src/lib/lusha/cap";

// The third cap: a per-BD DAILY ceiling in credits. NULL = no personal cap (not evaluated); 0 = blocked.
// 12 is Macarena's approved value and the arithmetic behind it: one contact costs 2 credits (search 1 + emails 1).

const PRICES = [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }];
const base: CapsInput = { spentToday: 0, spentCycle: 0, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: 12, expected: 2 };
const decide = (over: Partial<CapsInput>) => evaluateCaps({ ...base, ...over });

test("precedence when several caps refuse is monthly, then personal, then global daily", () => {
  const monthly = { spentCycle: 399, monthlyCap: 400 };
  const personal = { actorSpentToday: 11, personalCap: 12 };
  const daily = { spentToday: 59, dailyCap: 60 };
  assert.equal(!decide({ ...monthly, ...personal, ...daily }).allowed && (decide({ ...monthly, ...personal, ...daily }) as { blockedBy: string }).blockedBy, "monthly");
  assert.equal((decide({ ...monthly, ...personal }) as { blockedBy: string }).blockedBy, "monthly");
  assert.equal((decide({ ...monthly, ...daily }) as { blockedBy: string }).blockedBy, "monthly");
  assert.equal((decide({ ...personal, ...daily }) as { blockedBy: string }).blockedBy, "personal");
  assert.equal((decide({ ...personal }) as { blockedBy: string }).blockedBy, "personal");
  assert.equal((decide({ ...daily }) as { blockedBy: string }).blockedBy, "daily");
});

test("the remaining reported is the one of the cap that is named", () => {
  assert.deepEqual(decide({ spentCycle: 399, actorSpentToday: 11 }), { allowed: false, blockedBy: "monthly", remaining: 1 });
  assert.deepEqual(decide({ actorSpentToday: 11, spentToday: 58 }), { allowed: false, blockedBy: "personal", remaining: 1 });
  assert.deepEqual(decide({ spentToday: 59, personalCap: 40 }), { allowed: false, blockedBy: "daily", remaining: 1 });
});

test("boundary: 11 of 12 used and a 2-credit step is refused by the personal cap with 1 credit left (a cap never allows a step it cannot finish)", () => {
  assert.deepEqual(decide({ actorSpentToday: 11, expected: 2 }), { allowed: false, blockedBy: "personal", remaining: 1 });
  assert.deepEqual(decide({ actorSpentToday: 10, expected: 2 }), { allowed: true, remaining: 2 });
  assert.equal(decide({ actorSpentToday: 12, expected: 1 }).allowed, false);
});

test("an allowed decision reports the tightest remaining of the caps that were evaluated, the personal one included", () => {
  assert.deepEqual(decide({ actorSpentToday: 4 }), { allowed: true, remaining: 8 });
  assert.deepEqual(decide({ actorSpentToday: 4, personalCap: null }), { allowed: true, remaining: 60 });
});

test("a null personal cap leaves every other BD byte-identical to the two-cap behaviour, whatever the actor spend says", () => {
  // The two-cap evaluator exactly as it was before the personal cap existed.
  const legacy = ({ spentToday, spentCycle, dailyCap, monthlyCap, expected }: Pick<CapsInput, "spentToday" | "spentCycle" | "dailyCap" | "monthlyCap" | "expected">) => {
    const ok = [spentToday, spentCycle, dailyCap, monthlyCap, expected].every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0);
    if (!ok) return { allowed: false, blockedBy: "monthly", remaining: 0 };
    const monthly = evaluateCap({ spentToday: spentCycle, cap: monthlyCap, expected });
    if (!monthly.allowed) return { allowed: false, blockedBy: "monthly", remaining: monthly.remaining };
    const daily = evaluateCap({ spentToday, cap: dailyCap, expected });
    if (!daily.allowed) return { allowed: false, blockedBy: "daily", remaining: daily.remaining };
    return { allowed: true, remaining: Math.min(daily.remaining, monthly.remaining) };
  };
  const values = [0, 1, 2, 5, 11, 12, 58, 59, 60, 61, 398, 399, 400, 401, -1, 1.5, Number.NaN, 2 ** 53, "7" as never, null as never];
  let compared = 0;
  for (const spentToday of values) for (const spentCycle of values) for (const dailyCap of [0, 12, 60, null as never]) for (const monthlyCap of [0, 400]) for (const expected of [0, 1, 2, 5, 6.5]) {
    for (const actorSpentToday of [0, 11, 9999, Number.NaN, "x" as never, undefined as never]) {
      const input = { spentToday, spentCycle, dailyCap, monthlyCap, expected };
      assert.deepEqual(evaluateCaps({ ...input, actorSpentToday, personalCap: null }), legacy(input), JSON.stringify({ ...input, actorSpentToday }));
      compared++;
    }
  }
  assert.ok(compared > 10_000);
});

test("an explicit 0 personal cap blocks every step; it never means no cap", () => {
  assert.deepEqual(decide({ personalCap: 0, actorSpentToday: 0, expected: 1 }), { allowed: false, blockedBy: "personal", remaining: 0 });
  assert.equal(decide({ personalCap: 0, actorSpentToday: 0, expected: 0 }).allowed, true, "a zero-cost step still fits under a zero cap, as in the global caps");
});

test("fail closed: a personal cap that is not a non-negative safe integer refuses with nothing remaining, and undefined is not null", () => {
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "12" as never, undefined as never, true as never]) {
    assert.deepEqual(decide({ personalCap: bad }), { allowed: false, blockedBy: "personal", remaining: 0 }, String(bad));
  }
});

test("fail closed: with a personal cap set, a garbage actor spend refuses; with no cap it is not read at all", () => {
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 53, "7" as never, null as never, undefined as never]) {
    assert.deepEqual(decide({ actorSpentToday: bad }), { allowed: false, blockedBy: "personal", remaining: 0 }, String(bad));
    assert.equal(decide({ actorSpentToday: bad, personalCap: null }).allowed, true, `no cap ignores ${String(bad)}`);
  }
});

test("a garbage personal cap never hides the cap that ranks above it", () => {
  assert.equal((decide({ personalCap: -1, spentCycle: 399 }) as { blockedBy: string }).blockedBy, "monthly");
});

test("planReservation names the personal cap and carries what the actor has left", () => {
  const plan = (over: Partial<Parameters<typeof planReservation>[0]>) => planReservation({ field: "emails", canReveal: PRICES, spentToday: 0, spentCycle: 0, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: 12, ...over });
  assert.deepEqual(plan({ actorSpentToday: 12 }), { ok: false, reason: "cap_exceeded", cap: "personal", remaining: 0 });
  assert.deepEqual(plan({ actorSpentToday: 8, field: "phones" }), { ok: false, reason: "cap_exceeded", cap: "personal", remaining: 4 });
  assert.deepEqual(plan({ actorSpentToday: 11 }), { ok: true, credits: 1 });
  assert.deepEqual(plan({ actorSpentToday: 12, personalCap: null }), { ok: true, credits: 1 });
  assert.deepEqual(plan({ field: "search", canReveal: null, actorSpentToday: 12 }), { ok: false, reason: "cap_exceeded", cap: "personal", remaining: 0 });
});

test("the planners are pure: the same input twice gives the same answer and the input is not touched", () => {
  const input = Object.freeze({ field: "emails" as const, canReveal: Object.freeze([...PRICES]), spentToday: 3, spentCycle: 9, dailyCap: 60, monthlyCap: 400, actorSpentToday: 11, personalCap: 12 });
  assert.deepEqual(planReservation(input), planReservation(input));
  const caps = Object.freeze({ ...base, actorSpentToday: 11 });
  assert.deepEqual(evaluateCaps(caps), evaluateCaps(caps));
  assert.deepEqual(caps, { ...base, actorSpentToday: 11 });
});

test("a contact costs 2 credits, so a credit cap is shown with its contacts equivalent", () => {
  assert.equal(CREDITS_PER_CONTACT, 2);
  assert.equal(contactsWithinCredits(12), 6);
  assert.equal(contactsWithinCredits(11), 5, "rounds down: a half contact is not a contact");
  assert.equal(contactsWithinCredits(1), 0);
  assert.equal(contactsWithinCredits(0), 0);
});
