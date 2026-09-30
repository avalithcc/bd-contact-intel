/**
 * Unit tests for src/lib/dff2026/textClean.ts. Pure, no DB — run with:
 * npx tsx --test tests/unit/dff2026TextClean.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanField, repairMojibake, stripControlChars } from "@/lib/dff2026/textClean";

test("stripControlChars removes a NUL byte embedded mid-string", () => {
  assert.equal(stripControlChars("Juan\x00 Perez"), "Juan Perez");
});

test("stripControlChars preserves tab/newline/carriage-return", () => {
  assert.equal(stripControlChars("a\tb\nc\r"), "a\tb\nc\r");
});

test("cleanField trims, strips control chars, and collapses blank to null", () => {
  assert.equal(cleanField("  Juan\x00  "), "Juan");
  assert.equal(cleanField("   "), null);
  assert.equal(cleanField(""), null);
  assert.equal(cleanField(undefined), null);
  assert.equal(cleanField(null), null);
});

// --- repairMojibake (owner report, 2026-09-30: verified CP850-read-as-CP437
// corruption, 4 characters only) ---------------------------------------------

test("repairMojibake: each of the 4 verified mappings", () => {
  assert.equal(repairMojibake("╡"), "Á"); // "╡"
  assert.equal(repairMojibake("α"), "Ó"); // "α"
  assert.equal(repairMojibake("╓"), "Í"); // "╓"
  assert.equal(repairMojibake("╖"), "Á"); // "╖" — normalized, not the faithful "À"
});

test("repairMojibake: a string with no corruption passes through untouched", () => {
  const clean = "Gerente de Área, José García, ENERGÍA, FUNDACIÓN, COMPAÑÍA";
  assert.equal(repairMojibake(clean), clean);
});

test("repairMojibake: the real-world corrupted samples from the source file", () => {
  assert.equal(repairMojibake("Jefe De ╡rea"), "Jefe De Área");
  assert.equal(repairMojibake("FUNDACIαN DEL TUCUM╡N"), "FUNDACIÓN DEL TUCUMÁN");
  assert.equal(repairMojibake("ENERG╓A"), "ENERGÍA");
  assert.equal(repairMojibake("COMPAÑ╓A"), "COMPAÑÍA");
  assert.equal(repairMojibake("Gerente De ╖rea"), "Gerente De Área");
});

test("cleanField repairs mojibake as part of its cleaning pipeline", () => {
  assert.equal(cleanField("  Jefe De ╡rea  "), "Jefe De Área");
});
