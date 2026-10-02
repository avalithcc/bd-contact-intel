/**
 * Guest and event operations vocabulary joins the existing `operations`
 * group (no new group). `operations` is evaluated last, so every earlier
 * group still wins.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPosition } from "../../src/lib/roleGroups";

const REAL_TITLES = [
  "Public Relations Event Manager",
  "Director de Alojamiento",
  "Director de Ocio y Entretenimiento",
  "Guest Relations Specialist",
  "Director of Event",
];

test("the five real guest/event titles classify as operations", () => {
  for (const t of REAL_TITLES) assert.equal(classifyPosition(t), "operations", t);
});

test("related forms classify as operations", () => {
  for (const t of ["Directora de Alojamiento", "Guest Experience Manager", "Director of Events", "Director de Eventos", "Event Director"]) {
    assert.equal(classifyPosition(t), "operations", t);
  }
});

test("operations stays last: earlier groups still win", () => {
  assert.equal(classifyPosition("Marketing Event Manager"), "sales_bd");
  assert.equal(classifyPosition("Software Event Manager"), "developers");
  assert.equal(classifyPosition("Talent Event Manager"), "hr_recruiting");
  assert.equal(classifyPosition("Revenue Manager, Guest Relations"), "hospitality_revenue");
});

test("no new operations term routes anyone into developers or sales_bd", () => {
  for (const t of REAL_TITLES) {
    assert.ok(!["developers", "sales_bd"].includes(classifyPosition(t)), t);
  }
});

test("narrow: bare 'event', 'guest' or 'ocio' alone is not a term", () => {
  assert.equal(classifyPosition("Event Photographer"), "other");
  assert.equal(classifyPosition("Guest Speaker"), "other");
  assert.equal(classifyPosition("Ocio"), "other");
});
