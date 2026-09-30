/**
 * Unit tests for src/lib/dff2026/buildAttendeeRecords.ts. Pure, no DB — run
 * with: npx tsx --test tests/unit/dff2026BuildAttendeeRecords.test.ts
 *
 * Fixture rows are synthetic (task rule: never copy real rows from the
 * source file into tests), but mirror the measured header shape exactly:
 * a leading and trailing blank column, `"", ASISTIÓ, APELLIDO, NOMBRE,
 * EMPRESA, CARGO, OTRO CARGO, CELULAR, EMAIL, ""`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAttendeeRecords, resolveJobTitle } from "@/lib/dff2026/buildAttendeeRecords";

const HEADER = ",ASISTIÓ,APELLIDO,NOMBRE,EMPRESA,CARGO,OTRO CARGO,CELULAR,EMAIL,";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

test("resolveJobTitle: CARGO wins unless it reads 'Otro' (case/accent-insensitive)", () => {
  assert.equal(resolveJobTitle("Gerente", null), "Gerente");
  assert.equal(resolveJobTitle("Otro", "Consultora Senior"), "Consultora Senior");
  assert.equal(resolveJobTitle("OTRO", "Freelance"), "Freelance");
  assert.equal(resolveJobTitle("otro", null), null); // blank OTRO CARGO -> no title, not the literal word
  assert.equal(resolveJobTitle(null, "Consultora Senior"), null); // no CARGO at all
});

test("parses the header's duplicate blank columns by position, not by name", () => {
  const result = buildAttendeeRecords(csv([",1,Perez,Juan,Acme Corp,Manager,,1122334455,juan.perez@example.com,"]));
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    firstName: "Juan",
    lastName: "Perez",
    jobTitle: "Manager",
    mobilePhoneRaw: "1122334455",
    companyRaw: "Acme Corp",
    email: "juan.perez@example.com",
    emailNormalized: "juan.perez@example.com",
    attended: true,
  });
});

test("rows with no valid EMAIL are skipped, not imported", () => {
  const result = buildAttendeeRecords(
    csv([",1,NoEmail,Person,SomeCo,Dev,,123456789,,", ",1,HasEmail,Person,SomeCo,Dev,,123456789,has.email@example.com,"]),
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.skippedNoEmail, 1);
  assert.equal(result.rowsParsed, 2);
});

test("in-file duplicate emails collapse to the most complete row; attended is OR'd across duplicates", () => {
  const result = buildAttendeeRecords(
    csv([
      ",,Diaz,,Gamma,,,,dup@example.com,", // less complete, did not attend
      ",1,Diaz,Carlos,Gamma Inc,Director,,5555555555,dup@example.com,", // more complete, attended
    ]),
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.duplicateEmailCollisions.length, 1);
  assert.deepEqual(result.duplicateEmailCollisions[0], { email: "dup@example.com", occurrences: 2 });
  const record = result.records[0]!;
  assert.equal(record.firstName, "Carlos");
  assert.equal(record.companyRaw, "Gamma Inc");
  assert.equal(record.attended, true); // OR'd, even though the more-complete row alone already attended
});

test("strips NUL bytes and other control characters embedded in a field", () => {
  const result = buildAttendeeRecords(csv([",1,Ru\x00iz,Marta,Delta,Lead,,,marta.ruiz@example.com,"]));
  assert.equal(result.records[0]!.lastName, "Ruiz");
});

test("email is lowercased for emailNormalized but stored verbatim in email", () => {
  const result = buildAttendeeRecords(csv([",1,Perez,Juan,Acme,Manager,,,Juan.Perez@Example.com,"]));
  assert.equal(result.records[0]!.email, "Juan.Perez@Example.com");
  assert.equal(result.records[0]!.emailNormalized, "juan.perez@example.com");
});
