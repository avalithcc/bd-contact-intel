/**
 * Unit tests for src/lib/outreach/emailOutputParsing.ts — parses the
 * model's raw text output for the email channel into {subject, body}. The
 * prompt (messagePrompt.ts) asks for a bare JSON object, but a model can
 * still wrap it in a markdown code fence, add stray whitespace, or (rarely)
 * ignore the format entirely — this is the output-format parsing risk
 * flagged in the change description. No AI call here: pure string parsing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEmailModelOutput,
  MAX_SUBJECT_CHARS,
  MAX_BODY_CHARS,
} from "@/lib/outreach/emailOutputParsing";

test("parses a bare JSON object", () => {
  const result = parseEmailModelOutput('{"subject": "Hola", "body": "Cuerpo del correo"}');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo del correo" });
});

test("strips a markdown code fence around the JSON", () => {
  const result = parseEmailModelOutput('```json\n{"subject": "Hola", "body": "Cuerpo"}\n```');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo" });
});

test("strips a plain (unlabeled) code fence", () => {
  const result = parseEmailModelOutput('```\n{"subject": "Hola", "body": "Cuerpo"}\n```');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo" });
});

test("trims surrounding whitespace/newlines", () => {
  const result = parseEmailModelOutput('\n\n  {"subject": "Hola", "body": "Cuerpo"}  \n');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo" });
});

test("trims subject and body values themselves", () => {
  const result = parseEmailModelOutput('{"subject": "  Hola  ", "body": "  Cuerpo  "}');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo" });
});

test("returns null for invalid JSON", () => {
  assert.equal(parseEmailModelOutput("this is not json"), null);
});

test("returns null when subject is missing", () => {
  assert.equal(parseEmailModelOutput('{"body": "Cuerpo"}'), null);
});

test("returns null when body is missing", () => {
  assert.equal(parseEmailModelOutput('{"subject": "Hola"}'), null);
});

test("returns null when subject or body is empty after trimming", () => {
  assert.equal(parseEmailModelOutput('{"subject": "   ", "body": "Cuerpo"}'), null);
  assert.equal(parseEmailModelOutput('{"subject": "Hola", "body": "   "}'), null);
});

test("returns null when subject or body is not a string", () => {
  assert.equal(parseEmailModelOutput('{"subject": 1, "body": "Cuerpo"}'), null);
});

test("returns null for a JSON array or primitive", () => {
  assert.equal(parseEmailModelOutput("[1,2,3]"), null);
  assert.equal(parseEmailModelOutput('"just a string"'), null);
});

test("ignores extra unknown fields", () => {
  const result = parseEmailModelOutput('{"subject": "Hola", "body": "Cuerpo", "extra": true}');
  assert.deepEqual(result, { subject: "Hola", body: "Cuerpo" });
});

test("truncates a subject longer than MAX_SUBJECT_CHARS", () => {
  const longSubject = "A".repeat(MAX_SUBJECT_CHARS + 50);
  const result = parseEmailModelOutput(JSON.stringify({ subject: longSubject, body: "Cuerpo" }));
  assert.equal(result?.subject.length, MAX_SUBJECT_CHARS);
  assert.equal(result?.subject, "A".repeat(MAX_SUBJECT_CHARS));
});

test("truncates a body longer than MAX_BODY_CHARS", () => {
  const longBody = "B".repeat(MAX_BODY_CHARS + 500);
  const result = parseEmailModelOutput(JSON.stringify({ subject: "Hola", body: longBody }));
  assert.equal(result?.body.length, MAX_BODY_CHARS);
  assert.equal(result?.body, "B".repeat(MAX_BODY_CHARS));
});

test("collapses newlines inside the subject into spaces", () => {
  const result = parseEmailModelOutput(
    JSON.stringify({ subject: "Hola\ncómo\nva", body: "Cuerpo" }),
  );
  assert.equal(result?.subject, "Hola cómo va");
});

test("collapsing newlines in the subject happens before the length cap is applied", () => {
  // Many short lines that only exceed the cap once joined by real spaces
  // (a naive "cap first, then collapse" order could hide this).
  const lines = Array.from({ length: MAX_SUBJECT_CHARS }, () => "a");
  const subjectWithNewlines = lines.join("\n");
  const result = parseEmailModelOutput(
    JSON.stringify({ subject: subjectWithNewlines, body: "Cuerpo" }),
  );
  assert.ok(!result?.subject.includes("\n"));
  assert.ok((result?.subject.length ?? 0) <= MAX_SUBJECT_CHARS);
});

test("does not collapse newlines inside the body — only truncates", () => {
  const body = "Línea uno\nLínea dos\nLínea tres";
  const result = parseEmailModelOutput(JSON.stringify({ subject: "Hola", body }));
  assert.equal(result?.body, body);
});
