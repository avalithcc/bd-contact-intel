/**
 * Unit tests for src/lib/reports/meetingsDrilldown.ts — the "Reuniones
 * agendadas" KPI drilldown's pure row normalizer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMeetingDrilldownRows, type MeetingDrilldownRawRow } from "@/lib/reports/meetingsDrilldown";

const BASE: MeetingDrilldownRawRow = {
  activityId: "act-1",
  personId: "person-1",
  personFirstName: "Juan",
  personLastName: "Pérez",
  companyKey: "acme",
  companyName: "Acme SA",
  bdId: "bd-1",
  bdName: "Ana",
  meetingAt: "2026-09-15T12:00:00.000Z",
};

test("buildMeetingDrilldownRows normalizes a raw-SQL timestamp string into a real Date", () => {
  const [row] = buildMeetingDrilldownRows([BASE]);
  assert.ok(row!.meetingAt instanceof Date);
  assert.equal(row!.meetingAt.toISOString(), "2026-09-15T12:00:00.000Z");
});

test("buildMeetingDrilldownRows joins first/last name", () => {
  const [row] = buildMeetingDrilldownRows([BASE]);
  assert.equal(row!.personName, "Juan Pérez");
});

test("buildMeetingDrilldownRows falls back to an em dash when both names are missing", () => {
  const [row] = buildMeetingDrilldownRows([{ ...BASE, personFirstName: null, personLastName: null }]);
  assert.equal(row!.personName, "—");
});

test("buildMeetingDrilldownRows handles a person with no company (null companyKey/companyName)", () => {
  const [row] = buildMeetingDrilldownRows([{ ...BASE, companyKey: null, companyName: null }]);
  assert.equal(row!.companyKey, null);
  assert.equal(row!.companyName, null);
});

test("buildMeetingDrilldownRows never mutates its input array (pure planner rule)", () => {
  const input = [BASE];
  const clone = JSON.parse(JSON.stringify(input));
  buildMeetingDrilldownRows(input);
  assert.deepEqual(input, clone);
});
