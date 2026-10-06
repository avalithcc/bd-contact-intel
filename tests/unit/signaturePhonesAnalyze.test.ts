import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCandidates, formatSignatureReport, type CandidateRow } from "@/lib/signaturePhones/analyze";

const row = (over: Partial<CandidateRow>): CandidateRow => ({ messageId: "m", personId: "p1", attributed: true, phone: null, mobilePhone: null, body: null, ...over });

test("counts attribution skips, missing boundaries, rejections and outcomes", () => {
  const rows = [
    row({ messageId: "m1", body: "Gracias\nCel: 11 5555-0002" }),
    row({ messageId: "m2", body: "Ok\nCel: 11 5555-0002\n> Cel: 11 5555-0009" }),
    row({ messageId: "m3", personId: "p2", attributed: false, body: null }),
    row({ messageId: "m4", personId: "p3", body: "CUIT 30-71234567-8", phone: "4123 4567" }),
    row({ messageId: "m5", personId: "p4", body: "Cel: 11 5555-0010\nTel: 4123 4567" }),
  ];
  const { plan, report } = analyzeCandidates(rows);
  assert.equal(report.candidatesRead, 5);
  assert.equal(report.unresolvedSender, 1);
  assert.equal(report.examined, 4);
  assert.equal(report.bodiesNoBoundary, 3);
  assert.equal(report.rejected.cuit, 1);
  assert.equal(report.personsToFill, 2);
  assert.equal(report.personsConflictingKindUnstated, 0);
  assert.equal(report.personsBothWritten, 1);
  assert.equal(report.landlinesInferred, 1);
  assert.equal(report.personsConflicting, 0);
  assert.equal(plan.fills[0]?.supportingMessages, 2);
  assert.ok(formatSignatureReport(report).some((l) => l.includes("75.0%")));
});

test("the report text never contains a body, number or address", () => {
  const { report } = analyzeCandidates([row({ body: "Cel: 11 5555-0002 ana@example.test" })]);
  const text = formatSignatureReport(report).join("\n");
  assert.ok(!/5555|@/.test(text));
});
