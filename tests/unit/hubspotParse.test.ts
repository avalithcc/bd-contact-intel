/**
 * Unit tests for src/lib/hubspot/parse.ts (task 1.4).
 * Streams a HubSpot CSV export via csv-parse (design D2: `bom:true`,
 * `columns:true`, `skip_empty_lines:true`, `relax_column_count:false`) and
 * validates required headers before returning rows. All fixtures here are
 * synthetic (fake names, example.com) — never the real export.
 *
 * PII rule: a malformed row must fail with a sanitized message (line + code
 * only), never the raw csv-parse `CsvError.record`/`.raw`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHubSpotCsv } from "@/lib/hubspot/parse";

function writeFixture(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hubspot-parse-test-"));
  const path = join(dir, "fixture.csv");
  writeFileSync(path, contents, "utf8");
  return path;
}

test("parses a well-formed CSV with a UTF-8 BOM into row objects", async () => {
  const path = writeFixture(
    '﻿"ID de registro","Nombre"\n"1","Ana Prueba"\n"2","Beto Prueba"\n',
  );
  try {
    const rows = await parseHubSpotCsv(path);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]["Nombre"], "Ana Prueba");
    assert.equal(rows[1]["ID de registro"], "2");
  } finally {
    rmSync(path, { force: true });
  }
});

test("keeps a huge cell value intact instead of truncating it", async () => {
  const hugeValue = "x".repeat(50_000);
  const path = writeFixture(`"ID de registro","Associated Email"\n"1","${hugeValue}"\n`);
  try {
    const rows = await parseHubSpotCsv(path);
    assert.equal(rows[0]["Associated Email"]!.length, 50_000);
  } finally {
    rmSync(path, { force: true });
  }
});

test("rejects a CSV whose header row repeats a required column name", async () => {
  // "Correo" duplicated — csv-parse's columns:true would otherwise silently
  // keep only the second occurrence's values.
  const path = writeFixture('"ID de registro","Correo","Correo"\n"1","a@example.com","b@example.com"\n');
  try {
    await assert.rejects(() => parseHubSpotCsv(path, ["ID de registro", "Correo"]), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /duplicate required column/);
      assert.match(err.message, /Correo/);
      assert.doesNotMatch(err.message, /example\.com/);
      return true;
    });
  } finally {
    rmSync(path, { force: true });
  }
});

test("accepts a CSV whose header row repeats a NON-required column name", async () => {
  const path = writeFixture(
    '"ID de registro","Función laboral","Función laboral"\n"1","dev","manager"\n',
  );
  try {
    const rows = await parseHubSpotCsv(path, ["ID de registro"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["ID de registro"], "1");
  } finally {
    rmSync(path, { force: true });
  }
});

test("rejects a row with a mismatched column count (relax_column_count:false)", async () => {
  const path = writeFixture('"ID de registro","Nombre"\n"1","Ana Prueba","extra column"\n');
  try {
    await assert.rejects(() => parseHubSpotCsv(path), (err: unknown) => {
      assert.ok(err instanceof Error);
      // Sanitized message: line + code only, never the raw record content.
      assert.match(err.message, /^CSV parse failed at line \d+/);
      assert.doesNotMatch(err.message, /Ana Prueba/);
      return true;
    });
  } finally {
    rmSync(path, { force: true });
  }
});
