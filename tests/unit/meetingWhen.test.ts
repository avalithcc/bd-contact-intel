/**
 * How a meeting's date and time read on the Reuniones page, the contact record and the 18:00 email: "hoy 11:00 · hace 7 h",
 * "ayer 10:00", "jue 22 oct, 15:00", "18 oct, 10:00" — always the Argentina calendar, never the server's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMeetingAbsolute, formatMeetingWhen, type MeetingWhenLabels } from "@/lib/meetings/when";

test("the absolute form never depends on the clock: weekday, day, month and Argentina time", () => {
  assert.equal(formatMeetingAbsolute(new Date("2026-10-14T13:00:00.000Z")), "mié 14 oct, 10:00");
  assert.equal(formatMeetingAbsolute(new Date("2026-10-14T13:00:00.000Z"), { weekday: false }), "14 oct, 10:00");
  assert.equal(formatMeetingAbsolute(new Date("2026-10-23T01:30:00.000Z")), "jue 22 oct, 22:30");
});

const L: MeetingWhenLabels = { today: "hoy", yesterday: "ayer", tomorrow: "mañana", agoMinutes: "hace {n} min", agoHours: "hace {n} h" };
// 18:00 ART on Thu 2026-10-22.
const NOW = new Date("2026-10-22T21:00:00.000Z");
const art = (date: string, time: string) => new Date(`${date}T${time}:00.000-03:00`);

test("today and yesterday use words; the time is the Argentina wall clock", () => {
  assert.deepEqual(formatMeetingWhen(art("2026-10-22", "11:00"), NOW, L), { text: "hoy 11:00", ago: "hace 7 h" });
  assert.deepEqual(formatMeetingWhen(art("2026-10-21", "10:00"), NOW, L), { text: "ayer 10:00", ago: null });
  assert.deepEqual(formatMeetingWhen(art("2026-10-23", "09:30"), NOW, L), { text: "mañana 09:30", ago: null });
});

test("a meeting that started less than an hour ago says minutes", () => {
  assert.equal(formatMeetingWhen(art("2026-10-22", "17:20"), NOW, L).ago, "hace 40 min");
});

test("the 'ago' note only appears for a time already passed today, and never for a later time today", () => {
  assert.equal(formatMeetingWhen(art("2026-10-22", "19:00"), NOW, L).ago, null);
});

test("other days read weekday, day and month; the weekday can be left out for history", () => {
  assert.equal(formatMeetingWhen(art("2026-10-23", "15:00"), new Date("2026-10-20T12:00:00.000Z"), L).text, "vie 23 oct, 15:00");
  assert.equal(formatMeetingWhen(art("2026-10-26", "15:00"), NOW, L).text, "lun 26 oct, 15:00");
  assert.equal(formatMeetingWhen(art("2026-10-18", "10:00"), NOW, L, { weekday: false }).text, "18 oct, 10:00");
});

test("a meeting in another year shows the year", () => {
  assert.equal(formatMeetingWhen(art("2027-01-05", "10:00"), NOW, L, { weekday: false }).text, "5 ene 2027, 10:00");
});

test("a meeting just after midnight UTC but before midnight in Argentina is still that Argentina day", () => {
  assert.equal(formatMeetingWhen(new Date("2026-10-23T01:30:00.000Z"), NOW, L).text, "hoy 22:30");
});
