import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_COLUMNS, boardDropAction, isBoardStatus } from "@/lib/contacts/board";

test("14.1 RED->GREEN: BOARD_COLUMNS orders the five derived statuses new->contacted->replied->meeting->discarded", () => {
  assert.deepEqual(BOARD_COLUMNS, ["new", "contacted", "replied", "meeting", "discarded"]);
});

test("boardDropAction: dropping on Contactado opens the email quick action (email_sent drives that stage)", () => {
  assert.equal(boardDropAction("contacted"), "email");
});

test("boardDropAction: dropping on Reunión opens the meeting quick action", () => {
  assert.equal(boardDropAction("meeting"), "meeting");
});

test("boardDropAction: dropping on Descartado opens the discard quick action", () => {
  assert.equal(boardDropAction("discarded"), "discard");
});

test("boardDropAction: Nuevo and Respondió have no supported manual log action, so dropping there is a no-op", () => {
  assert.equal(boardDropAction("new"), null);
  assert.equal(boardDropAction("replied"), null);
});

test("isBoardStatus: rejects an unknown/arbitrary string (query-string safety)", () => {
  assert.equal(isBoardStatus("new"), true);
  assert.equal(isBoardStatus("bogus"), false);
});
