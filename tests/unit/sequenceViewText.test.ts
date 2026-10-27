import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { assertClientStrings } from "@/lib/i18n/clientStrings";
import { OPT_OUT_DISCARD_REASON } from "@/lib/sequences/optOut";
import { HOLD_REASONS } from "@/lib/sequences/preSendChecks";
import { agoText, fill, miamiWhen } from "@/lib/sequences/viewText";

const NOW = new Date("2026-10-15T14:00:00Z"); // 10:00 Miami (EDT)
const ago = { agoMinutes: "{n} min", agoHours: "{n} h", agoDays: "{n} d" };

test("fill replaces every placeholder and leaves unknown ones visible", () => {
  assert.equal(fill("{a} de {b} y {a}", { a: 4, b: "10" }), "4 de 10 y 4");
  assert.equal(fill("{missing}", {}), "{missing}");
});

test("agoText picks minutes, hours or days like the mockup ('2 h', '4 d')", () => {
  assert.equal(agoText(new Date(NOW.getTime() - 20 * 60_000), NOW, ago), "20 min");
  assert.equal(agoText(new Date(NOW.getTime() - 2 * 3_600_000), NOW, ago), "2 h");
  assert.equal(agoText(new Date(NOW.getTime() - 4 * 86_400_000), NOW, ago), "4 d");
  assert.equal(agoText(new Date(NOW.getTime() + 5_000), NOW, ago), "1 min", "never zero or negative");
});

test("miamiWhen reads the Miami calendar day and wall clock, across DST", () => {
  assert.deepEqual(miamiWhen(new Date("2026-10-16T13:00:00Z"), NOW), { day: "tomorrow", ddmm: "16/10", hhmm: "09:00" });
  assert.deepEqual(miamiWhen(new Date("2026-10-15T13:00:00Z"), NOW), { day: "today", ddmm: "15/10", hhmm: "09:00" });
  // Winter (EST, UTC-5): the same 09:00 Miami is 14:00Z.
  assert.deepEqual(miamiWhen(new Date("2026-12-01T14:00:00Z"), NOW), { day: "other", ddmm: "01/12", hhmm: "09:00" });
});

test("the sequences slice is client-safe and complete in both languages", () => {
  for (const d of [es, en]) {
    assertClientStrings(d.sequences);
    assert.deepEqual(Object.keys(d.sequences.holdReasons).sort(), [...HOLD_REASONS].sort());
  }
  assert.deepEqual(Object.keys(es.sequences).sort(), Object.keys(en.sequences).sort());
});

test("every system-written sequence discard reason has a label in both languages", () => {
  // The codes the system itself writes to sequence_member.discard_reason: opt_out (optOut.ts), bounce (gmail/bounceQueries.ts)
  // and merge_duplicate (sequences/mergeQueries.ts). The last two modules open the database on import, so their values are
  // spelled out here. A BD removal reason is free text and is shown as typed.
  for (const d of [es, en]) {
    for (const code of [OPT_OUT_DISCARD_REASON, "bounce", "merge_duplicate"]) {
      const label = (d.sequences.discardReasons as Record<string, string>)[code];
      assert.ok(label && label !== code, code);
    }
  }
});
