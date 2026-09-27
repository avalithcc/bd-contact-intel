import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_COLUMNS, boardDropAction, isBoardDropAction, isBoardStatus } from "@/lib/contacts/board";

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

test("isBoardDropAction: accepts exactly the three quick-action kinds a board drop can open (BoardDnD.tsx parses ?openAction= from a menu link's href)", () => {
  assert.equal(isBoardDropAction("email"), true);
  assert.equal(isBoardDropAction("meeting"), true);
  assert.equal(isBoardDropAction("discard"), true);
  assert.equal(isBoardDropAction("bogus"), false);
  assert.equal(isBoardDropAction(""), false);
});
