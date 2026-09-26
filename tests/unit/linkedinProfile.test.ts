import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedinProfileHref } from "@/lib/contacts/linkedinProfile";

test("null profileKey -> null href", () => {
  assert.equal(linkedinProfileHref(null), null);
});

test("re-adds https:// to a normalized profileKey", () => {
  assert.equal(linkedinProfileHref("linkedin.com/in/valentina-rojas"), "https://linkedin.com/in/valentina-rojas");
});
