/**
 * The must-list is only worth pasting to the administrative area if every requirement was actually asked AND answered.
 *
 * The defect this pins came from production on 2026-11-19: on a real 23-page pliego the model answered four of the eight
 * requirement keys and omitted the other four, while its own "viability" text described the five profiles the pliego
 * demands and the certified balance sheet. The omission was honest in the data (mustListIncluded stayed false and the
 * ficha asked for a new analysis) but the feature produced nothing, every time, for the owner.
 *
 * The fixture below is the SHAPE production returned - four keys answered, four absent - not an invented one, because the
 * failure is "keys are missing from the object", and a fixture that spells every key out cannot reproduce it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { generateText } from "ai";
import {
  ANALYSIS_SYSTEM_PROMPT,
  mergeRequirementPatch,
  missingRequirementKeys,
  parseTenderAnalysis,
  requirementFollowUpPrompt,
} from "@/lib/tenders/analysis";
import { runTenderAnalysis } from "@/lib/tenders/analyse";

/** Exactly what production stored: registration, antecedents, guarantee and submissionDeadline only. */
const PARTIAL = {
  summary: "Soporte y mantenimiento del sistema ESIGA por doce meses.",
  viability: "Encaja, pero hay que verificar los 5 perfiles exigidos y el balance certificado.",
  requirements: {
    registration: "SIPRO vigente (Articulo 16)",
    antecedents: "DOS certificaciones de servicios similares (Articulo 15.1.7)",
    guarantee: "5% de la oferta (5.1), 10% del contrato (5.2)",
    submissionDeadline: "Segun cronograma del Portal COMPR.AR",
  },
  pages: 23,
};

const COMPLETE_PATCH = {
  certifications: null,
  financialStanding: "Balance certificado y estructura de costos (Anexo II)",
  team: "Cinco perfiles: Representante Tecnico, Analista Funcional Senior, Desarrollador Full-stack Senior, DBA MySQL, Consultor SSAS/Power BI",
  affidavits: "Declaracion jurada de habilidad para contratar (Anexo IV)",
};

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** Answers each call in order and records what it was asked, so the follow-up's shape is asserted, not assumed. */
function scriptedGenerate(answers: string[]) {
  const calls: { messages: unknown[]; maxOutputTokens: number }[] = [];
  const generate = (async (opts: { messages: unknown[]; maxOutputTokens: number }) => {
    calls.push({ messages: opts.messages, maxOutputTokens: opts.maxOutputTokens });
    const text = answers[calls.length - 1];
    if (text === undefined) throw new Error(`unexpected model call #${calls.length}`);
    return { text, finishReason: "stop" };
  }) as unknown as typeof generateText;
  return { generate, calls };
}

test("an absent requirement key is named; a key answered with null is not", () => {
  assert.deepEqual(missingRequirementKeys(PARTIAL), ["certifications", "financialStanding", "team", "affidavits"]);
  assert.deepEqual(missingRequirementKeys({ ...PARTIAL, requirements: { ...PARTIAL.requirements, ...COMPLETE_PATCH } }), []);
  assert.deepEqual(missingRequirementKeys(null), ["registration", "antecedents", "guarantee", "submissionDeadline", "certifications", "financialStanding", "team", "affidavits"]);
});

test("a patch fills only what was missing and never overwrites an answer the first reading gave", () => {
  const merged = mergeRequirementPatch(PARTIAL, { ...COMPLETE_PATCH, registration: "WRONG, must not win" });
  const req = merged.requirements as Record<string, unknown>;
  assert.equal(req.registration, "SIPRO vigente (Articulo 16)");
  assert.equal(req.team, COMPLETE_PATCH.team);
  assert.equal(req.financialStanding, COMPLETE_PATCH.financialStanding);
  // null is an answer: it must survive the merge rather than be treated as still missing.
  assert.equal(req.certifications, null);
  assert.deepEqual(missingRequirementKeys(merged), []);
});

test("a patch the model wrapped in its own \"requirements\" object is accepted too", () => {
  const merged = mergeRequirementPatch(PARTIAL, { requirements: COMPLETE_PATCH });
  assert.deepEqual(missingRequirementKeys(merged), []);
  assert.equal((merged.requirements as Record<string, unknown>).team, COMPLETE_PATCH.team);
});

test("dropped keys are asked for again, and the completed reading carries the must-list", async () => {
  const { generate, calls } = scriptedGenerate([JSON.stringify(PARTIAL), JSON.stringify(COMPLETE_PATCH)]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.analysis.mustListIncluded, true);
  assert.equal(result.analysis.requirements.team, COMPLETE_PATCH.team);
  assert.equal(result.analysis.requirements.registration, "SIPRO vigente (Articulo 16)");
  assert.equal(result.analysis.requirements.certifications, null);

  assert.equal(calls.length, 2);
  // The follow-up carries the document and the first answer, and names every missing key.
  const followUp = calls[1]!.messages as { role: string; content: unknown }[];
  assert.equal(followUp.length, 3);
  assert.equal(followUp[1]!.role, "assistant");
  const asked = followUp[2]!.content as string;
  for (const k of ["certifications", "financialStanding", "team", "affidavits"]) assert.ok(asked.includes(`"${k}"`), k);
  assert.ok(!asked.includes('"registration"'), "an answered key is never re-asked");
  assert.ok(calls[1]!.maxOutputTokens < calls[0]!.maxOutputTokens);
});

test("a complete first answer costs exactly one model call", async () => {
  const complete = { ...PARTIAL, requirements: { ...PARTIAL.requirements, ...COMPLETE_PATCH } };
  const { generate, calls } = scriptedGenerate([JSON.stringify(complete)]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);
  assert.ok(result.ok);
  assert.equal(result.analysis.mustListIncluded, true);
  assert.equal(calls.length, 1);
});

test("a re-ask that answers nothing stops the loop instead of paying for the next one", async () => {
  const { generate, calls } = scriptedGenerate([JSON.stringify(PARTIAL), JSON.stringify({ unrelated: "nada" })]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);
  assert.ok(result.ok);
  assert.equal(calls.length, 2);
  // Reported as incomplete rather than papered over: the ficha asks for a new analysis.
  assert.equal(result.analysis.mustListIncluded, false);
  assert.equal(result.analysis.requirements.team, null);
  assert.equal(result.analysis.requirements.registration, "SIPRO vigente (Articulo 16)");
});

test("partial progress is kept and the second re-ask asks only for what is still missing", async () => {
  const half = { team: COMPLETE_PATCH.team, financialStanding: COMPLETE_PATCH.financialStanding };
  const rest = { certifications: null, affidavits: COMPLETE_PATCH.affidavits };
  const { generate, calls } = scriptedGenerate([JSON.stringify(PARTIAL), JSON.stringify(half), JSON.stringify(rest)]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);
  assert.ok(result.ok);
  assert.equal(result.analysis.mustListIncluded, true);
  assert.equal(calls.length, 3);
  const second = (calls[2]!.messages as { content: unknown }[])[2]!.content as string;
  assert.ok(second.includes('"certifications"') && second.includes('"affidavits"'));
  assert.ok(!second.includes('"team"'), "a key answered by the first re-ask is not asked a second time");
});

test("the loop is bounded: a model that never answers the missing keys stops after two re-asks", async () => {
  // Each re-ask answers ONE key, so the loop always makes progress and only the cap can stop it.
  const { generate, calls } = scriptedGenerate([
    JSON.stringify(PARTIAL),
    JSON.stringify({ team: COMPLETE_PATCH.team }),
    JSON.stringify({ affidavits: COMPLETE_PATCH.affidavits }),
  ]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);
  assert.ok(result.ok);
  assert.equal(calls.length, 3, "one first answer plus REQUIREMENT_RETRY_ATTEMPTS re-asks, never more");
  assert.equal(result.analysis.mustListIncluded, false);
  assert.equal(result.analysis.requirements.team, COMPLETE_PATCH.team);
});

test("a first answer that is not JSON still fails, and costs no re-ask", async () => {
  const { generate, calls } = scriptedGenerate(["lo siento, no puedo leer el documento"]);
  const result = await runTenderAnalysis(pdf, "pliego.pdf", generate);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
});

test("the prompt makes completeness a rule, points past the administrative section, and ties viability to requirements", () => {
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes("Every one of those eight keys must be present in the object."));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes("including the technical specifications and the annexes"));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('Anything you name in "viability" as something the bidder must have, hold or prove must also appear under the matching "requirements" key.'));
  // Still intact: the rule that absence is reported, never invented.
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes("Use null for any the document does not state."));
});

test("the follow-up asks for a bare object and reads naturally for one key and for many", () => {
  const one = requirementFollowUpPrompt(["team"]);
  assert.ok(one.includes("this key") && one.includes("that key") && one.includes('"team"'));
  const many = requirementFollowUpPrompt(["team", "affidavits"]);
  assert.ok(many.includes("these keys") && many.includes("those keys"));
  assert.ok(many.includes("Use null only when you have looked and the document truly does not state it."));
});

test("the completed object is exactly what the normal parser would have accepted in one pass", () => {
  const complete = { ...PARTIAL, requirements: { ...PARTIAL.requirements, ...COMPLETE_PATCH } };
  const direct = parseTenderAnalysis(JSON.stringify(complete))!;
  assert.equal(direct.mustListIncluded, true);
  assert.equal(direct.pages, 23);
});
