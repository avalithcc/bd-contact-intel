import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRecipients } from "@/lib/email/recipients/summary";

test("two names are shown and the rest collapse into +N with everyone in the tooltip", () => {
  const out = summarizeRecipients([
    { name: "Lucía Fernández", email: "lucia@acme.test" },
    { name: "Martín Gómez", email: "martin@acme.test" },
    { name: "Sofía Paz", email: "sofia@acme.test" },
  ]);
  assert.deepEqual(out.shown, ["Lucía Fernández", "Martín Gómez"]);
  assert.equal(out.more, 1);
  assert.equal(out.full, "Lucía Fernández <lucia@acme.test>, Martín Gómez <martin@acme.test>, Sofía Paz <sofia@acme.test>");
});

test("one or two recipients show no +N", () => {
  assert.equal(summarizeRecipients([{ name: "A" }]).more, 0);
  assert.equal(summarizeRecipients([{ name: "A" }, { name: "B" }]).more, 0);
});

test("a recipient without a name falls back to the address", () => {
  assert.deepEqual(summarizeRecipients([{ name: "", email: "x@acme.test" }]).shown, ["x@acme.test"]);
  assert.deepEqual(summarizeRecipients([]), { shown: [], more: 0, full: "" });
});
