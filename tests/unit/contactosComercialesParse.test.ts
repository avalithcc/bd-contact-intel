import assert from "node:assert/strict";
import { test } from "node:test";
import { emailKey, normalizeComercialPhone, parseComerciales } from "@/lib/contactosComerciales/parse";
import { footer, header, inColumn, intro, PAGE_1, PAGE_2, row } from "./contactosComercialesFixtures";

const doc = (...lines: string[]) => lines.join("\n");

test("parses a full row", () => {
  const [r] = parseComerciales(doc(header(PAGE_1), "", row(PAGE_1, { first: "Ana", last: "Test", company: "Acme (Prueba)", email: "Ana.Test@Acme.example", phone: "+54 9 11 5555 0100" })));
  assert.deepEqual(r, { firstName: "Ana", lastName: "Test", company: "Acme (Prueba)", lastContact: "01-02-2026", email: "Ana.Test@Acme.example", phones: ["+54 9 11 5555 0100"], nameInferred: false });
});

test("a dash first name and a blank surname are null; a dash phone is no phone", () => {
  const [r] = parseComerciales(doc(header(PAGE_1), row(PAGE_1, { email: "x@acme.example", company: "Acme" })));
  assert.equal(r!.firstName, null);
  assert.equal(r!.lastName, null);
  assert.deepEqual(r!.phones, []);
});

test("the inferred marker on a continuation line keeps the surname and flags the row", () => {
  const [r] = parseComerciales(doc(header(PAGE_1), row(PAGE_1, { first: "Luz", last: "Prueba", email: "l@acme.example" }), inColumn(PAGE_1, 1, "(inferido del mail)")));
  assert.equal(r!.lastName, "Prueba");
  assert.equal(r!.nameInferred, true);
});

test("the inferred marker as the whole surname cell is never stored as a surname", () => {
  const [r] = parseComerciales(doc(header(PAGE_1), row(PAGE_1, { first: "Luz", last: "(inferido del mail)", email: "l@acme.example" })));
  assert.equal(r!.lastName, null);
  assert.equal(r!.nameInferred, true);
});

test("a continuation line adds a second phone, or a job title that is ignored", () => {
  const rows = parseComerciales(
    doc(
      header(PAGE_1),
      row(PAGE_1, { first: "A", email: "a@acme.example", phone: "+1 (555) 010-0001" }),
      inColumn(PAGE_1, 5, "617-555-0102 ext 120"),
      row(PAGE_1, { first: "B", email: "b@acme.example" }),
      inColumn(PAGE_1, 2, "Head of Testing"),
    ),
  );
  assert.deepEqual(rows[0]!.phones, ["+1 (555) 010-0001", "617-555-0102 ext 120"]);
  assert.deepEqual(rows[1]!.phones, []);
});

test("columns are read per page: shifted header, drifted cells, footer and intro line are not rows", () => {
  const rows = parseComerciales(
    doc(
      intro, "", header(PAGE_1), row(PAGE_1, { first: "A", email: "a@acme.example", phone: "+54 223 555 0100" }),
      footer(1), "", header(PAGE_2),
      row(PAGE_2, { first: "B", email: "b@acme.example", phone: "+34 600 000 000" }, 1),
      inColumn(PAGE_2, 5, "+34 600 000 111"), footer(2),
    ),
  );
  assert.deepEqual(rows.map((r) => [r.firstName, r.email, r.phones]), [
    ["A", "a@acme.example", ["+54 223 555 0100"]],
    ["B", "b@acme.example", ["+34 600 000 000", "+34 600 000 111"]],
  ]);
});

test("a footnote line mentioning the marker does not flag the previous row", () => {
  const [r] = parseComerciales(doc(header(PAGE_1), row(PAGE_1, { first: "A", last: "B", email: "a@acme.example" }), "(inferido del mail) = nombre deducido de la direccion"));
  assert.equal(r!.nameInferred, false);
});

test("phone shapes: the dialable part is kept and extensions are flagged", () => {
  const cases: [string, string | null, boolean, boolean][] = [
    ["+54 9 11 7887 0779", "+54 9 11 7887 0779", false, false],
    ["+1 (754) 241-0674", "+1 (754) 241-0674", false, false],
    ["+54 223 628 8500 ext 1016", "+54 223 628 8500", true, false],
    ["617-340-3850 ext 120", "617-340-3850", true, false],
    ["617-340-3850 EXT. 7", "617-340-3850", true, false],
    ["12345", null, false, true],
    ["call me", null, false, true],
  ];
  for (const [raw, value, extensionDropped, invalid] of cases) {
    assert.deepEqual(normalizeComercialPhone(raw), { value, extensionDropped, invalid }, raw);
  }
});

test("emailKey lowercases and trims", () => {
  assert.equal(emailKey("  Ana.Test@Acme.EXAMPLE "), "ana.test@acme.example");
});
