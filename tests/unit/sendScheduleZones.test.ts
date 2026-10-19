/**
 * Visual time-zone reference of the schedule popover (enviar-o-programar.html section 3). Nothing here changes when an
 * email leaves; it only states the same instant in other clocks. Reference instant: Thu 22 Oct 2026 10:00 ART = 13:00 UTC.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroupRows, buildZoneRows, localAdvisory, resolveRecipientZone, suggestBusinessDay, type RecipientZone } from "@/lib/sendSchedule/zones";

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

test("the recipient row replaces the fixed one with the same zone and warns when the local time is before 9:00 or on a weekend", () => {
  const rows = buildZoneRows(THU_10_ART, zone({ country: "Mexico", city: "Ciudad de México" }));
  assert.deepEqual(rows.map((r) => r.key), ["argentina", "recipient", "newYork", "madrid", "bogota", "saoPaulo"]);
  const lucia = rows[1]!;
  assert.deepEqual([lucia.clocks, lucia.warn], [["7:00"], true]);
  const tampa = buildZoneRows(THU_10_ART, zone({ country: "United States", region: "FL" }));
  assert.deepEqual(tampa.map((r) => r.key), ["argentina", "recipient", "madrid", "mexicoCity", "bogota", "saoPaulo"]);
  assert.equal(tampa[1]!.warn, false);
});

test("the advisory fires before 9:00 local (8:59 yes, 9:00 no) and on Saturday or Sunday in the RECIPIENT zone", () => {
  const madrid = "Europe/Madrid";
  assert.deepEqual(localAdvisory(new Date("2026-10-22T06:59:00Z"), madrid), { early: true, weekend: false, weekday: 4, clock: "8:59" });
  assert.equal(localAdvisory(new Date("2026-10-22T07:00:00Z"), madrid), null);
  assert.equal(localAdvisory(new Date("2026-10-22T21:00:00Z"), madrid), null); // 23:00 on a Thursday: late is not an advisory
  assert.deepEqual(localAdvisory(new Date("2026-10-24T10:00:00Z"), madrid), { early: false, weekend: true, weekday: 6, clock: "12:00" });
  assert.equal(localAdvisory(new Date("2026-10-25T10:00:00Z"), madrid)?.weekday, 0);
});

test("a day shift across zones decides the weekday: Friday evening in Argentina is already Saturday in Madrid", () => {
  const fridayNight = new Date("2026-10-24T00:00:00Z"); // Fri 23 Oct 21:00 ART = Sat 24 Oct 02:00 Madrid
  assert.equal(localAdvisory(fridayNight, "America/Argentina/Buenos_Aires"), null);
  assert.deepEqual(localAdvisory(fridayNight, "Europe/Madrid"), { early: true, weekend: true, weekday: 6, clock: "2:00" });
  const rows = buildZoneRows(fridayNight, zone({ country: "Spain" }));
  assert.deepEqual([rows[1]!.warn, rows[1]!.dayShift], [true, 1]);
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

test("suggestBusinessDay offers 9:00 recipient time: the same day when it is early, the next Monday over a weekend", () => {
  // Thu 10:00 ART = 7:00 in Mexico City: 9:00 there is 12:00 ART the same day.
  assert.deepEqual(suggestBusinessDay(THU_10_ART, "America/Mexico_City"), { slot: { date: "2026-10-22", time: "12:00" }, weekday: 4, localClock: "9:00" });
  // Sat 24 Oct 02:00 Madrid: Monday 26 Oct 9:00 Madrid (CET, UTC+1) = 08:00Z = 05:00 ART.
  assert.deepEqual(suggestBusinessDay(new Date("2026-10-24T00:00:00Z"), "Europe/Madrid"), { slot: { date: "2026-10-26", time: "05:00" }, weekday: 1, localClock: "9:00" });
  assert.equal(suggestBusinessDay(new Date("2026-10-22T15:00:00Z"), "America/Mexico_City"), null);
});

test("several recipients are grouped by country: distinct local times, the count, and the warning if any is early or on a weekend", () => {
  const fl = zone({ country: "United States", region: "Florida" });
  const tx = zone({ country: "United States", region: "Texas" });
  const mx = zone({ country: "Mexico", city: "Guadalajara" });
  const rows = buildGroupRows(new Date("2026-10-21T13:30:00Z"), [fl, fl, tx, tx, tx, mx, mx]); // 10:30 ART
  const us = rows.find((r) => r.group === "us")!;
  assert.deepEqual([us.count, us.clocks, us.warn, us.areas], [5, ["9:30", "8:30"], true, ["Florida", "Texas"]]); // Texas is at 8:30
  const mexico = rows.find((r) => r.group === "mx")!;
  assert.deepEqual([mexico.count, mexico.clocks, mexico.warn], [2, ["7:30"], true]);
  assert.deepEqual(rows.map((r) => r.key).slice(0, 3), ["argentina", "recipients", "recipients"]);
});
