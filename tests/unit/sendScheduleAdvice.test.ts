/**
 * The non-blocking disclaimer of the send control: for the RECIPIENT's local time (or Miami for a Sequence recipient whose
 * place is unknown), warn when the send falls before 9:00 or on a weekend. Never a restriction; one-off emails to a
 * recipient with no known place get no disclaimer at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdvice } from "@/lib/sendSchedule/advice";
import { resolveRecipientZone } from "@/lib/sendSchedule/zones";

const mexico = { name: "Lucía", zone: resolveRecipientZone({ country: "Mexico", city: "Ciudad de México" }) };
const spain = { name: "Marta", zone: resolveRecipientZone({ country: "Spain" }) };
const nowhere = { name: "Pedro", zone: null };
const THU_10_ART = new Date("2026-10-22T13:00:00Z"); // 7:00 Mexico City, 15:00 Madrid
const SAT_ART = new Date("2026-10-24T15:00:00Z"); // Saturday noon in Argentina, Madrid and Mexico City

test("a single recipient before 9:00 gets the message in their own clock and a same-day suggestion", () => {
  const a = buildAdvice(THU_10_ART, [mexico], null);
  assert.equal(a?.kind, "single");
  if (a?.kind !== "single") return;
  assert.deepEqual([a.name, a.place, a.clock, a.weekday, a.early, a.weekend], ["Lucía", "Ciudad de México, México", "7:00", 4, true, false]);
  assert.deepEqual(a.suggestion?.slot, { date: "2026-10-22", time: "12:00" });
});

test("a weekend in the recipient zone suggests the next Monday", () => {
  const a = buildAdvice(SAT_ART, [spain], null);
  assert.equal(a?.kind, "single");
  if (a?.kind !== "single") return;
  assert.deepEqual([a.weekday, a.early, a.weekend], [6, false, true]);
  assert.equal(a.suggestion?.weekday, 1);
});

test("the day shift counts: Friday evening in Argentina is Saturday night in Madrid", () => {
  const a = buildAdvice(new Date("2026-10-24T00:00:00Z"), [spain], null);
  assert.equal(a?.kind === "single" && a.weekend, true);
});

test("nothing to say when the recipient is in business hours on a weekday", () => {
  assert.equal(buildAdvice(THU_10_ART, [spain], null), null);
});

test("an unknown place falls back to Miami for Sequences and to nothing for a one-off email", () => {
  const miami = buildAdvice(new Date("2026-10-22T11:00:00Z"), [nowhere], "America/New_York"); // 7:00 Miami
  assert.equal(miami?.kind, "miami");
  assert.equal(miami?.kind === "miami" && miami.clock, "7:00");
  assert.equal(buildAdvice(new Date("2026-10-22T11:00:00Z"), [nowhere], null), null);
});

test("several recipients are counted, not listed", () => {
  const a = buildAdvice(THU_10_ART, [mexico, mexico, spain], null);
  assert.deepEqual(a && a.kind === "bulk" ? [a.n, a.total] : null, [2, 3]);
  assert.equal(buildAdvice(THU_10_ART, [spain, spain], null), null);
});
