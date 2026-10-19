/**
 * Visual time-zone reference of the schedule popover (enviar-o-programar.html section 3). Nothing here changes when an
 * email leaves; it only states the same instant in other clocks. Reference instant: Thu 22 Oct 2026 10:00 ART = 13:00 UTC.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroupRows, buildZoneRows, resolveRecipientZone, suggestInHours, type RecipientZone } from "@/lib/sendSchedule/zones";

const THU_10_ART = new Date("2026-10-22T13:00:00Z");
const zone = (p: Parameters<typeof resolveRecipientZone>[0]) => resolveRecipientZone(p) as RecipientZone;

test("one default zone per country, marked approximate only when the country spans several", () => {
  assert.deepEqual(resolveRecipientZone({ country: "Spain" }), { zone: "Europe/Madrid", approx: false, place: "España", area: "España", group: "es" });
  assert.equal(zone({ country: "Argentina" }).zone, "America/Argentina/Buenos_Aires");
  assert.equal(zone({ country: "Mexico" }).approx, true);
  assert.equal(zone({ country: "Brazil" }).approx, true);
  assert.equal(zone({ country: "United States" }).approx, true);
  assert.equal(zone({ country: "Colombia" }).approx, false);
});

test("country spellings and accents resolve to the same entry", () => {
  for (const c of ["USA", "US", "United States of America", "EE. UU.", "Estados Unidos", "united states"]) assert.equal(zone({ country: c }).group, "us", c);
  for (const c of ["México", "Mexico", "MEXICO"]) assert.equal(zone({ country: c }).group, "mx", c);
});

test("a known city fixes a multi-zone country: no 'aprox.'", () => {
  const cdmx = zone({ country: "Mexico", city: "Ciudad de México" });
  assert.equal(cdmx.zone, "America/Mexico_City");
  assert.equal(cdmx.approx, false);
  assert.equal(zone({ country: "Mexico", city: "Tijuana" }).zone, "America/Tijuana");
  assert.equal(zone({ country: "Brazil", city: "Manaus" }).zone, "America/Manaus");
  assert.equal(zone({ country: "Canada", city: "Vancouver" }).zone, "America/Vancouver");
});

test("US: the state (name or abbreviation) fixes the zone, the city is the fallback, otherwise Eastern 'aprox.'", () => {
  const tampa = zone({ country: "United States", city: "Tampa", region: "Florida" });
  assert.deepEqual([tampa.zone, tampa.approx, tampa.area], ["America/New_York", false, "Florida"]);
  assert.equal(zone({ country: "United States", region: "TX" }).zone, "America/Chicago");
  assert.equal(zone({ country: "United States", region: "California" }).zone, "America/Los_Angeles");
  assert.equal(zone({ country: "United States", region: "Arizona" }).zone, "America/Phoenix");
  assert.equal(zone({ country: "United States", city: "Austin" }).zone, "America/Chicago");
  const unknown = zone({ country: "United States", city: "Springfield" });
  assert.deepEqual([unknown.zone, unknown.approx], ["America/New_York", true]);
});

test("no known place gives no recipient zone", () => {
  assert.equal(resolveRecipientZone({}), null);
  assert.equal(resolveRecipientZone({ country: "  " }), null);
  assert.equal(resolveRecipientZone({ country: "Atlantis" }), null);
});

test("without a recipient: Argentina first (base) and the five fixed references", () => {
  const rows = buildZoneRows(THU_10_ART, null);
  assert.deepEqual(rows.map((r) => [r.key, r.clocks[0]]), [["argentina", "10:00"], ["newYork", "9:00"], ["madrid", "15:00"], ["mexicoCity", "7:00"], ["bogota", "8:00"], ["saoPaulo", "10:00"]]);
});

test("the recipient row replaces the fixed one with the same zone and warns outside 8:00-19:00", () => {
  const rows = buildZoneRows(THU_10_ART, zone({ country: "Mexico", city: "Ciudad de México" }));
  assert.deepEqual(rows.map((r) => r.key), ["argentina", "recipient", "newYork", "madrid", "bogota", "saoPaulo"]);
  const lucia = rows[1]!;
  assert.deepEqual([lucia.clocks, lucia.outside], [["7:00"], true]);
  const tampa = buildZoneRows(THU_10_ART, zone({ country: "United States", region: "FL" }));
  assert.deepEqual(tampa.map((r) => r.key), ["argentina", "recipient", "madrid", "mexicoCity", "bogota", "saoPaulo"]);
  assert.equal(tampa[1]!.outside, false);
});

test("the window edges 8:00 and 19:00 are inside", () => {
  const edge = (iso: string) => buildZoneRows(new Date(iso), zone({ country: "Spain" }))[1]!.outside;
  assert.equal(edge("2026-10-22T06:00:00Z"), false); // 8:00 Madrid (CEST)
  assert.equal(edge("2026-10-22T05:59:00Z"), true);
  assert.equal(edge("2026-10-22T17:00:00Z"), false); // 19:00 Madrid
  assert.equal(edge("2026-10-22T17:01:00Z"), true);
});

test("a local time on another calendar day than Argentina's carries the shift", () => {
  // 21:00 ART Thu = 02:00 Fri in Madrid (CEST, UTC+2).
  const rows = buildZoneRows(new Date("2026-10-23T00:00:00Z"), null);
  assert.equal(rows.find((r) => r.key === "madrid")!.dayShift, 1);
  assert.equal(rows.find((r) => r.key === "madrid")!.clocks[0], "2:00");
  assert.equal(rows.find((r) => r.key === "argentina")!.dayShift, 0);
  // 00:30 ART Fri = 23:30 Thu in Bogota.
  assert.equal(buildZoneRows(new Date("2026-10-23T03:30:00Z"), null).find((r) => r.key === "bogota")!.dayShift, -1);
});

test("daylight saving follows the chosen date, not today", () => {
  // New York leaves EDT on 1 Nov: the same 10:00 ART is 9:00 on 22 Oct and 8:00 on 2 Nov.
  const ny = (iso: string) => buildZoneRows(new Date(iso), null).find((r) => r.key === "newYork")!.clocks[0];
  assert.equal(ny("2026-10-22T13:00:00Z"), "9:00");
  assert.equal(ny("2026-11-02T13:00:00Z"), "8:00");
});

test("suggestInHours moves an early recipient to 8:00 their time, a late one to 19:00, and leaves a good time alone", () => {
  const mexico = zone({ country: "Mexico", city: "Ciudad de México" });
  assert.deepEqual(suggestInHours(THU_10_ART, mexico), { slot: { date: "2026-10-22", time: "11:00" }, localClock: "8:00" });
  const madrid = zone({ country: "Spain" });
  // 18:30 ART = 23:30 Madrid -> 19:00 Madrid = 14:00 ART.
  assert.deepEqual(suggestInHours(new Date("2026-10-22T21:30:00Z"), madrid), { slot: { date: "2026-10-22", time: "14:00" }, localClock: "19:00" });
  assert.equal(suggestInHours(new Date("2026-10-22T15:00:00Z"), mexico), null);
});

test("several recipients are grouped by country: distinct local times, the count, and the warning if any is outside", () => {
  const fl = zone({ country: "United States", region: "Florida" });
  const tx = zone({ country: "United States", region: "Texas" });
  const mx = zone({ country: "Mexico", city: "Guadalajara" });
  const rows = buildGroupRows(new Date("2026-10-21T13:30:00Z"), [fl, fl, tx, tx, tx, mx, mx]); // 10:30 ART
  const us = rows.find((r) => r.group === "us")!;
  assert.deepEqual([us.count, us.clocks, us.outside, us.areas], [5, ["9:30", "8:30"], false, ["Florida", "Texas"]]);
  const mexico = rows.find((r) => r.group === "mx")!;
  assert.deepEqual([mexico.count, mexico.clocks, mexico.outside], [2, ["7:30"], true]);
  assert.deepEqual(rows.map((r) => r.key).slice(0, 3), ["argentina", "recipients", "recipients"]);
});
