import { test } from "node:test";
import assert from "node:assert/strict";
import { completedToastMessage } from "../../src/lib/tasks/completedToastMessage";

test("names the task after the label", () => {
  assert.equal(completedToastMessage("Tarea completada", "Llamar a Ana"), "Tarea completada: Llamar a Ana");
});

test("truncates a long title with an ellipsis", () => {
  const msg = completedToastMessage("Tarea completada", "x".repeat(100));
  assert.equal(msg, `Tarea completada: ${"x".repeat(39)}…`);
});

test("keeps a title exactly at the limit and collapses whitespace", () => {
  assert.equal(completedToastMessage("L", "y".repeat(40)), `L: ${"y".repeat(40)}`);
  assert.equal(completedToastMessage("L", "  a \n b  "), "L: a b");
});

test("falls back to the label alone for a blank title", () => {
  assert.equal(completedToastMessage("Tarea completada", "   "), "Tarea completada");
});

test("clamps by code point, so an emoji at the cut is not split in half", () => {
  // Each 📞 is TWO UTF-16 code units, so a `slice(0, 39)` on `String.length`
  // would land inside the surrogate pair and emit a lone surrogate — the
  // toast would read "<?>…". 40 phones are 40 code points, so nothing is cut;
  // 41 are clamped to the first 39, every one of them whole.
  const fits = "📞".repeat(40);
  assert.equal(completedToastMessage("L", fits), `L: ${fits}`);

  const over = "📞".repeat(41);
  const msg = completedToastMessage("L", over);
  assert.equal(msg, `L: ${"📞".repeat(39)}…`);
  assert.equal(Array.from(msg).filter((c) => c === "�").length, 0);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(msg), "no lone high surrogate");
});
