import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAgo, formatInstant, formatYmdDayMonth, type FleetTimeLabels } from "@/lib/gmail/fleetFormat";

const L: FleetTimeLabels = {
  today: "hoy",
  yesterday: "ayer",
  ago: "hace {t}",
  lessThanMinute: "menos de 1 min",
  minutes: "{n} min",
  hoursMinutes: "{h} h {m} min",
  hours: "{h} h",
  days: "{n} días",
};

// 10:44 ART on Sunday 18 Oct 2026 (UTC-3).
const NOW = new Date("2026-10-18T13:44:00Z");
const art = (iso: string) => new Date(`${iso}-03:00`);

test("formatInstant: today and yesterday use the Argentina wall clock", () => {
  assert.equal(formatInstant(art("2026-10-18T10:42:00"), NOW, L), "hoy 10:42");
  assert.equal(formatInstant(art("2026-10-17T18:02:00"), NOW, L), "ayer 18:02");
});

test("formatInstant: older instants show the date, with the time unless asked for the date alone", () => {
  assert.equal(formatInstant(art("2026-10-07T16:20:00"), NOW, L), "7 oct 2026, 16:20");
  assert.equal(formatInstant(art("2026-10-07T16:20:00"), NOW, L, { timeWhenOlder: false }), "7 oct 2026");
});

test("formatInstant: an instant at 22:30 ART belongs to its ART day, not the UTC one", () => {
  assert.equal(formatInstant(new Date("2026-10-18T01:30:00Z"), NOW, L), "ayer 22:30");
});

test("formatAgo follows the mockup's short form", () => {
  const min = 60_000;
  assert.equal(formatAgo(20_000, L), "hace menos de 1 min");
  assert.equal(formatAgo(13 * min, L), "hace 13 min");
  assert.equal(formatAgo(151 * min, L), "hace 2 h 31 min");
  assert.equal(formatAgo(120 * min, L), "hace 2 h");
  assert.equal(formatAgo(17 * 60 * min, L), "hace 17 h");
  assert.equal(formatAgo(11 * 24 * 60 * min, L), "hace 11 días");
});

test("formatYmdDayMonth renders a calendar date without a time zone shift", () => {
  assert.equal(formatYmdDayMonth("2026-10-21"), "21 oct");
  assert.equal(formatYmdDayMonth("2026-01-05"), "5 ene");
});
