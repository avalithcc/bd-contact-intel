import assert from "node:assert/strict";
import { test } from "node:test";
import { artDayWindow, planReservation } from "../../src/lib/lusha/cap";
import { toLatestRows } from "../../src/lib/lusha/revealState";

const iso = (d: Date) => d.toISOString();
const PRICES = [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }, { field: "free", credits: 0 }];

test("the day window follows the Argentina business day at 23:30 (UTC is already tomorrow)", () => {
  const w = artDayWindow(new Date("2026-10-15T02:30:00.000Z")); // 23:30 ART on the 14th
  assert.deepEqual([iso(w.start), iso(w.end)], ["2026-10-14T03:00:00.000Z", "2026-10-15T03:00:00.000Z"]);
});

test("the day window rolls over at 00:30 ART", () => {
  const w = artDayWindow(new Date("2026-10-15T03:30:00.000Z")); // 00:30 ART on the 15th
  assert.deepEqual([iso(w.start), iso(w.end)], ["2026-10-15T03:00:00.000Z", "2026-10-16T03:00:00.000Z"]);
});

test("the window is half-open at ART midnight, and ignores Lusha's resetsAt", () => {
  const before = artDayWindow(new Date("2026-10-15T02:59:59.999Z"));
  const at = artDayWindow(new Date("2026-10-15T03:00:00.000Z"));
  assert.equal(iso(before.end), iso(at.start));
  assert.notEqual(iso(before.start), iso(at.start));
});

test("a reveal is capped on the price read now: at the cap is allowed, one over is refused", () => {
  assert.deepEqual(planReservation({ field: "phones", canReveal: PRICES, spentToday: 7, spentCycle: 7, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: true, credits: 5 });
  assert.deepEqual(planReservation({ field: "phones", canReveal: PRICES, spentToday: 8, spentCycle: 8, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: false, reason: "cap_exceeded", cap: "daily", remaining: 4 });
});

test("a stored price of 0 is never an uncapped free action: it reserves at least one credit", () => {
  assert.deepEqual(planReservation({ field: "free" as never, canReveal: PRICES, spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: true, credits: 1 });
  assert.equal(planReservation({ field: "free" as never, canReveal: PRICES, spentToday: 12, spentCycle: 12, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }).ok, false);
  assert.equal(planReservation({ field: "free" as never, canReveal: PRICES, spentToday: 0, spentCycle: 0, dailyCap: 0, monthlyCap: 400, actorSpentToday: 0, personalCap: null }).ok, false, "cap 0 is the kill switch");
});

test("a search reserves its fixed cost without a price list; a reveal without one is refused", () => {
  assert.deepEqual(planReservation({ field: "search", canReveal: null, spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: true, credits: 1 });
  assert.deepEqual(planReservation({ field: "emails", canReveal: null, spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: false, reason: "no_price_list" });
  assert.deepEqual(planReservation({ field: "emails", canReveal: [], spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }), { ok: false, reason: "not_revealable" });
});

test("a non-numeric spend (raw aggregate string) is refused, never allowed", () => {
  assert.equal(planReservation({ field: "emails", canReveal: PRICES, spentToday: "7" as never, spentCycle: 0, dailyCap: 12, monthlyCap: 400, actorSpentToday: 0, personalCap: null }).ok, false);
});

test("toLatestRows maps one row per field and carries the compliance flag from any row", () => {
  const row = (field: "search" | "emails" | "phones", blocked = false) => ({
    id: `id-${field}`, searchId: field === "search" ? null : "id-search", at: new Date(), field, state: "settled" as const, outcome: "matched", value: null, payload: {}, blocked,
  });
  const out = toLatestRows([row("search"), row("phones", true)]);
  assert.equal(out.search?.id, "id-search");
  assert.equal(out.phones?.searchId, "id-search");
  assert.equal(out.emails, undefined);
  assert.equal(out.complianceBlocked, true);
  assert.deepEqual(toLatestRows([]), { complianceBlocked: false });
});
