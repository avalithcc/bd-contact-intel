/**
 * Pure rules of the shared "Enviar ahora / Programar…" control: typed time, the 15-minute list, the presets (all read in
 * Argentina time) and the slot rules (past, lead, Miami floor). Mockup: enviar-o-programar.html section 2.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTimeInput, quarterHourOptions, schedulePresets, slotState, summaryLine } from "@/lib/sendSchedule/time";

test("parseTimeInput reads the shapes the mockup promises", () => {
  assert.equal(parseTimeInput("9:30"), "09:30");
  assert.equal(parseTimeInput("930"), "09:30");
  assert.equal(parseTimeInput("0930"), "09:30");
  assert.equal(parseTimeInput("21"), "21:00");
  assert.equal(parseTimeInput(" 7:05 "), "07:05");
  assert.equal(parseTimeInput("9"), "09:00");
  assert.equal(parseTimeInput("23:59"), "23:59");
});

test("parseTimeInput rejects what is not a clock time", () => {
  for (const bad of ["", "abc", "24:00", "9:75", "25", "12:5", "1234567", "9:30pm"]) assert.equal(parseTimeInput(bad), null, bad);
});

test("quarterHourOptions is the whole day every 15 minutes", () => {
  const options = quarterHourOptions();
  assert.equal(options.length, 96);
  assert.equal(options[0], "00:00");
  assert.equal(options[37], "09:15");
  assert.equal(options[95], "23:45");
});

test("presets are Argentina time: +1 h rounded up to the quarter, tomorrow 9:00, next Monday 9:00", () => {
  // Mon 19 Oct 2026 11:42 ART = 14:42 UTC (the mockup's clock).
  const p = schedulePresets(new Date("2026-10-19T14:42:00Z"));
  assert.deepEqual(p.hour, { date: "2026-10-19", time: "12:45" });
  assert.deepEqual(p.tomorrow, { date: "2026-10-20", time: "09:00" });
  assert.deepEqual(p.monday, { date: "2026-10-26", time: "09:00" }); // today is Monday: the NEXT one
});

test("the +1 h preset crosses midnight in Argentina, not in UTC", () => {
  // Fri 23 Oct 2026 23:30 ART = Sat 02:30 UTC.
  const p = schedulePresets(new Date("2026-10-24T02:30:00Z"));
  assert.deepEqual(p.hour, { date: "2026-10-24", time: "00:30" });
  assert.deepEqual(p.tomorrow, { date: "2026-10-24", time: "09:00" });
  assert.deepEqual(p.monday, { date: "2026-10-26", time: "09:00" });
});

const NOW = new Date("2026-10-19T14:42:00Z"); // Mon 11:42 ART, 10:42 Miami

test("slotState without a floor: past and under the 5-minute lead are refused, the rest is ok", () => {
  assert.equal(slotState({ date: "2026-10-19", time: "11:00" }, { now: NOW, floorHour: null }), "past");
  assert.equal(slotState({ date: "2026-10-19", time: "11:45" }, { now: NOW, floorHour: null }), "too_soon");
  assert.equal(slotState({ date: "2026-10-19", time: "11:46" }, { now: NOW, floorHour: null }), "too_soon");
  assert.equal(slotState({ date: "2026-10-19", time: "11:47" }, { now: NOW, floorHour: null }), "ok");
  assert.equal(slotState({ date: "2026-11-19", time: "09:00" }, { now: NOW, floorHour: null }), "too_far");
  assert.equal(slotState({ date: "2026-10-20", time: "05:00" }, { now: NOW, floorHour: null }), "ok");
});

test("slotState with the Miami floor: before 9:00 Miami is refused on that Miami day", () => {
  // 2026-10-20 10:00 ART = 09:00 Miami (EDT): exactly the floor, ok. 09:45 ART = 08:45 Miami: before it.
  assert.equal(slotState({ date: "2026-10-20", time: "10:00" }, { now: NOW, floorHour: 9 }), "ok");
  assert.equal(slotState({ date: "2026-10-20", time: "09:45" }, { now: NOW, floorHour: 9 }), "before_floor");
  // After the US clock change (1 Nov) Miami is UTC-5: 9:00 Miami is 11:00 ART.
  assert.equal(slotState({ date: "2026-11-02", time: "10:00" }, { now: NOW, floorHour: 9 }), "before_floor");
  assert.equal(slotState({ date: "2026-11-02", time: "11:00" }, { now: NOW, floorHour: 9 }), "ok");
});

test("summaryLine words the moment in plain Spanish", () => {
  assert.equal(summaryLine({ date: "2026-10-22", time: "10:00" }), "jue 22 oct a las 10:00");
  assert.equal(summaryLine({ date: "2026-10-26", time: "09:05" }), "lun 26 oct a las 9:05");
});
