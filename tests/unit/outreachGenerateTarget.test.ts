/**
 * Which server action + which id the /contacts outreach row's "Generar
 * mensaje" control binds. The two actions live in different id spaces
 * (legacy contact.id vs unified person.id), so swapping them 404s.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { outreachRowGenerateTarget } from "@/lib/outreach/generateTarget";

test("own legacy contact keeps the contact-based action with the contact id", () => {
  assert.deepEqual(
    outreachRowGenerateTarget({ id: "contact-1", hasOwnContact: true, personId: "person-1" }),
    { kind: "contact", id: "contact-1" },
  );
});

test("teammate's contact binds the person-based action with the PERSON id, not row.id", () => {
  const target = outreachRowGenerateTarget({ id: "person-1", hasOwnContact: false, personId: "person-1" });
  assert.deepEqual(target, { kind: "person", id: "person-1" });
  // row.id and personId differ in practice for mixed rows; the person id must win.
  assert.deepEqual(
    outreachRowGenerateTarget({ id: "some-contact-id", hasOwnContact: false, personId: "person-9" }),
    { kind: "person", id: "person-9" },
  );
});

test("id spaces are never swapped", () => {
  const own = outreachRowGenerateTarget({ id: "C", hasOwnContact: true, personId: "P" });
  assert.equal(own.kind === "contact" && own.id, "C");
  const mate = outreachRowGenerateTarget({ id: "C", hasOwnContact: false, personId: "P" });
  assert.equal(mate.kind === "person" && mate.id, "P");
});

test("own contact without a personId (legacy-shaped row) still uses the contact action", () => {
  assert.deepEqual(outreachRowGenerateTarget({ id: "contact-2", hasOwnContact: true }), {
    kind: "contact",
    id: "contact-2",
  });
});

test("neither an own contact nor a personId has no action", () => {
  assert.deepEqual(outreachRowGenerateTarget({ id: "x", hasOwnContact: false }), { kind: "none" });
});
