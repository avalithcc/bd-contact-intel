import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPickerOptions, matchTypedAddress, type PickerCandidate } from "@/lib/email/recipients/picker";

const c = (id: string, name: string, email: string | null, jobTitle: string | null = null): PickerCandidate => ({ id, name, email, jobTitle });
const list = [
  c("1", "Martín Gómez", "martin@acme.test", "Head of Engineering"),
  c("2", "Sofía Paz", "sofia@acme.test", "Product Manager"),
  c("3", "Valeria Acosta", null, "People Lead"),
  c("4", "Diego Ríos", "diego@acme.test", "CTO"),
];

test("options hide people already picked and keep contacts without email (disabled in the UI)", () => {
  const out = filterPickerOptions(list, new Set(["2"]), "");
  assert.deepEqual(out.map((o) => o.id), ["1", "3", "4"]);
  assert.equal(out.find((o) => o.id === "3")!.disabled, true);
  assert.equal(out.find((o) => o.id === "1")!.disabled, false);
});

test("the query matches name, email and job title, ignoring case and accents", () => {
  assert.deepEqual(filterPickerOptions(list, new Set(), "martin").map((o) => o.id), ["1"]);
  assert.deepEqual(filterPickerOptions(list, new Set(), "RIOS").map((o) => o.id), ["4"]);
  assert.deepEqual(filterPickerOptions(list, new Set(), "product").map((o) => o.id), ["2"]);
  assert.deepEqual(filterPickerOptions(list, new Set(), "acme.test").map((o) => o.id), ["1", "2", "4"]);
  assert.deepEqual(filterPickerOptions(list, new Set(), "zzz"), []);
});

test("a typed address becomes a chip only when it is the email of a listed contact", () => {
  assert.equal(matchTypedAddress(list, new Set(), " SOFIA@acme.test ")?.id, "2");
  assert.equal(matchTypedAddress(list, new Set(), "pablo@otraempresa.example"), null);
  assert.equal(matchTypedAddress(list, new Set(["2"]), "sofia@acme.test"), null, "already a recipient");
  assert.equal(matchTypedAddress(list, new Set(), ""), null);
  assert.equal(matchTypedAddress(list, new Set(), "Valeria Acosta"), null, "a name is not an address");
});
