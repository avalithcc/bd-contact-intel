/**
 * Unit tests for src/lib/contacts/companyLogo.ts — the "Empresa" column's
 * company-logo initial chip (mockups/contacts.html: "ML" for Mercado
 * Libre, "G" for Globant — a single-word company gets ONE letter, unlike
 * the person-avatar convention (initialsFromName) which takes two letters
 * from a lone word). Pure only — no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";

test("companyLogoInitials: a two-word company takes the first letter of each word", () => {
  assert.equal(companyLogoInitials("Mercado Libre"), "ML");
  assert.equal(companyLogoInitials("Ciudad de Mexico"), "CD");
});

test("companyLogoInitials: a single-word company takes ONE letter, not two", () => {
  assert.equal(companyLogoInitials("Globant"), "G");
  assert.equal(companyLogoInitials("Nubank"), "N");
});

test("companyLogoInitials: blank/whitespace-only input renders as '?', same convention as initialsFromName", () => {
  assert.equal(companyLogoInitials(""), "?");
  assert.equal(companyLogoInitials("   "), "?");
});

test("companyLogoInitials: always uppercase", () => {
  assert.equal(companyLogoInitials("nubank"), "N");
  assert.equal(companyLogoInitials("mercado libre"), "ML");
});
