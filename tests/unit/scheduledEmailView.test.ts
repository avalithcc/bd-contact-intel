import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionsFor,
  clockLabel,
  needsSendConfirm,
  nextMondayNineMiami,
  replySnippet,
  sendNowDisabled,
  stateOf,
  wasLabel,
  whenLabel,
} from "@/lib/scheduledEmail/view";

const NOW = new Date("2026-10-16T17:00:00Z"); // Fri 14:00 Argentina, 13:00 Miami
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

test("stateOf: a scheduled row is locked from 2 minutes before it goes out", () => {
  assert.equal(stateOf({ status: "scheduled", sendAt: at(10), error: null }, NOW), "scheduled");
  assert.equal(stateOf({ status: "scheduled", sendAt: at(3), error: null }, NOW), "scheduled");
  assert.equal(stateOf({ status: "scheduled", sendAt: at(2), error: null }, NOW), "locked");
  assert.equal(stateOf({ status: "sending", sendAt: at(-1), error: null }, NOW), "locked");
});

test("stateOf: held and failed rows are never locked, and a dead token is told apart from the rest", () => {
  assert.equal(stateOf({ status: "on_hold", sendAt: at(-600), error: null }, NOW), "on_hold");
  assert.equal(stateOf({ status: "failed", sendAt: at(-60), error: "gmail_not_connected" }, NOW), "failed_gmail");
  assert.equal(stateOf({ status: "failed", sendAt: at(-60), error: "gmail_unavailable" }, NOW), "failed_other", "provably not sent");
  assert.equal(stateOf({ status: "failed", sendAt: at(-60), error: "outcome_unknown" }, NOW), "failed_unconfirmed", "may have gone out");
  assert.equal(stateOf({ status: "failed", sendAt: at(-60), error: null }, NOW), "failed_unconfirmed", "an unknown code is never assumed unsent");
});

test("actionsFor: what each state offers, and nothing once locked", () => {
  assert.deepEqual(actionsFor("scheduled"), ["edit", "changeTime", "sendNow", "cancel"]);
  assert.deepEqual(actionsFor("locked"), []);
  assert.deepEqual(actionsFor("on_hold"), ["sendAnyway", "edit", "cancel"]);
  assert.deepEqual(actionsFor("failed_gmail"), ["sendNow", "reschedule", "edit", "cancel"]);
  assert.deepEqual(actionsFor("failed_other"), ["sendNow", "reschedule", "edit", "cancel"]);
  assert.deepEqual(actionsFor("failed_unconfirmed"), ["sendNow", "reschedule", "edit", "cancel"]);
});

test("needsSendConfirm: only a row whose first attempt may have succeeded", () => {
  assert.equal(needsSendConfirm("failed_unconfirmed"), true);
  for (const state of ["scheduled", "locked", "on_hold", "failed_gmail", "failed_other"] as const) assert.equal(needsSendConfirm(state), false, state);
});

test("sendNowDisabled: only a dead-token row with Gmail still disconnected", () => {
  assert.equal(sendNowDisabled("failed_gmail", false), true);
  assert.equal(sendNowDisabled("failed_gmail", true), false);
  assert.equal(sendNowDisabled("failed_other", false), false);
  assert.equal(sendNowDisabled("scheduled", false), false);
});

test("whenLabel / clockLabel read the same instant in each zone", () => {
  const monday = new Date("2026-10-19T13:00:00Z"); // 10:00 Argentina, 09:00 Miami
  assert.equal(whenLabel(monday, "argentina"), "lun 19 oct, 10:00");
  assert.equal(whenLabel(monday, "miami"), "lun 19 oct, 9:00");
  assert.equal(clockLabel(monday, "miami"), "9:00");
});

test("wasLabel: 'hoy' only for the same Argentina day", () => {
  assert.equal(wasLabel(new Date("2026-10-16T12:00:00Z"), NOW, "hoy"), "hoy 9:00");
  assert.equal(wasLabel(new Date("2026-10-15T12:00:00Z"), NOW, "hoy"), "jue 15 oct, 9:00");
});

test("nextMondayNineMiami: strictly after today in Miami, at 09:00 Miami", () => {
  // Friday 2026-10-16 in Miami -> Monday 2026-10-19 09:00 EDT = 13:00Z.
  assert.equal(nextMondayNineMiami(NOW).toISOString(), "2026-10-19T13:00:00.000Z");
  // A Monday asks for the NEXT Monday, never today.
  assert.equal(nextMondayNineMiami(new Date("2026-10-19T12:00:00Z")).toISOString(), "2026-10-26T13:00:00.000Z");
  // After the DST change (Nov 1) Miami is UTC-5.
  assert.equal(nextMondayNineMiami(new Date("2026-11-05T12:00:00Z")).toISOString(), "2026-11-09T14:00:00.000Z");
});

test("replySnippet: first paragraph, collapsed, bounded", () => {
  assert.equal(replySnippet("Gracias, lo vemos\ncon el equipo.\n\nEl lun escribió:\n> hola"), "Gracias, lo vemos con el equipo.");
  assert.equal(replySnippet("x".repeat(300))?.length, 141);
  assert.equal(replySnippet(null), null);
  assert.equal(replySnippet("   "), null);
});
