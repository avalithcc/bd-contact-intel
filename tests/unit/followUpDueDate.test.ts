/**
 * The note box's follow-up task always carries a due date: a follow-up with
 * no date never becomes "Hoy" or "Vencidas", so nothing would ever surface it.
 * The default is tomorrow's calendar day in Argentina (the app's day).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFollowUpDueDate } from "@/lib/contacts/followUpDueDate";

test("defaults to tomorrow's Argentina calendar day", () => {
  // 15:00Z is 12:00 ART on 3 Oct.
  assert.equal(defaultFollowUpDueDate(new Date("2026-10-03T15:00:00Z")), "2026-10-04");
});

test("at 22:07 ART (UTC already tomorrow) it is still the Argentina day that counts", () => {
  // 01:07Z on 4 Oct is 22:07 ART on 3 Oct, so tomorrow is the 4th, not the 5th.
  assert.equal(defaultFollowUpDueDate(new Date("2026-10-04T01:07:00Z")), "2026-10-04");
});

test("rolls over a month boundary", () => {
  assert.equal(defaultFollowUpDueDate(new Date("2026-10-31T15:00:00Z")), "2026-11-01");
});
