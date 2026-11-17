/**
 * The fixtures below are not invented: they are real subjects read out of production on 2026-11-16, when the owner
 * reported that sequence subjects were abstract. The subject rule had forbidden this vocabulary in writing for weeks.
 *
 * So the test that matters is not "the validator works on a made-up string" — it is "the validator rejects the exact
 * text that shipped". If any of these ever passes again, this feature has regressed to where it was.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SUBJECT_MAX_CHARS, describeViolations, validateSubject } from "@/lib/outreach/subjectRules";

/** Verbatim from `sequence_draft.subject`, most recent first. */
const SHIPPED_AND_SHOULD_NOT_HAVE = [
  "Capacidad senior de ingeniería para tu equipo",
  "Capacidad senior para tu equipo de ingeniería",
  "Capacidad de ingeniería senior para tu equipo",
  "Capacidad senior adicional para tu equipo de ingeniería",
  "Capacidad senior para el equipo de Daniel",
  "Capacidad senior de ingenieria para tu equipo",
  "Capacidad senior para roles de seguridad y data en Nubank",
  "Capacidad senior para Security y Data en Nubank",
];

describe("validateSubject, against subjects that actually shipped", () => {
  for (const subject of SHIPPED_AND_SHOULD_NOT_HAVE) {
    it(`rejects: ${subject}`, () => {
      const violations = validateSubject(subject);
      assert.ok(violations.length > 0, `should have been rejected: ${subject}`);
    });
  }

  it('catches the split form a substring check misses: "Capacidad de ingeniería senior"', () => {
    const subject = "Capacidad de ingeniería senior para tu equipo";
    assert.ok(!subject.toLowerCase().includes("capacidad senior"), "precondition: the exact phrase is NOT present");
    const violations = validateSubject(subject);
    assert.ok(
      violations.some((v) => v.kind === "banned_word_pair"),
      "the split form must still be caught",
    );
  });

  it("does not report the same text twice when the exact phrase is present", () => {
    const violations = validateSubject("Capacidad senior para tu equipo");
    const phrase = violations.filter((v) => v.kind === "banned_phrase");
    const pair = violations.filter((v) => v.kind === "banned_word_pair");
    assert.equal(phrase.length, 1);
    assert.equal(pair.length, 0, "the exact phrase already covers it");
  });

  it("rejects the 72-character subject that passed the 150-char safety cap", () => {
    const subject = "Ingeniería en Flybondi, una pregunta rápida para ayudarte en tus equipos";
    assert.equal(subject.length, 72);
    const violations = validateSubject(subject);
    assert.ok(violations.some((v) => v.kind === "too_long" && v.max === SUBJECT_MAX_CHARS));
  });

  it("rejects selling to ourselves", () => {
    const violations = validateSubject("Capacidad de ingeniería senior para Avalith");
    assert.ok(violations.some((v) => v.kind === "names_avalith"));
  });

  it("rejects a subject that names the sender", () => {
    const violations = validateSubject("Cristian te escribe sobre backend", { senderName: "Cristian Civita" });
    assert.ok(violations.some((v) => v.kind === "names_sender"));
  });

  it("ignores a sender whose first name is too short to match safely", () => {
    const violations = validateSubject("Backend en Card y Fraud, sin pisar a RRHH", { senderName: "Al Smith" });
    assert.deepEqual(violations, []);
  });
});

describe("validateSubject, against subjects the rule wants", () => {
  // The shape examples from SUBJECT_RULE itself: if the validator rejected these, the prompt and the check disagree.
  const GOOD = [
    "Affirm suma backend en Card y Fraud",
    "Backend en Card y Fraud, sin pisar a RRHH",
    "Los roles de Identity y Payments: otra vía",
    "Reforzar ingeniería sin sumar a RRHH",
  ];
  for (const subject of GOOD) {
    it(`accepts: ${subject}`, () => {
      assert.deepEqual(validateSubject(subject), [], `wrongly rejected: ${subject}`);
    });
  }

  it("is accent-insensitive, so the unaccented spelling is judged the same", () => {
    assert.deepEqual(validateSubject("Capacidad senior de ingenieria para tu equipo").length > 0, true);
    assert.deepEqual(validateSubject("Reforzar ingenieria sin sumar a RRHH"), []);
  });

  it("accepts a subject exactly at the ceiling and rejects one character more", () => {
    const atLimit = "a".repeat(SUBJECT_MAX_CHARS);
    assert.deepEqual(validateSubject(atLimit), []);
    assert.ok(validateSubject("a".repeat(SUBJECT_MAX_CHARS + 1)).some((v) => v.kind === "too_long"));
  });
});

describe("describeViolations", () => {
  it("names every broken rule, so a retry is told what to fix rather than asked again blindly", () => {
    const text = describeViolations(validateSubject("Capacidad de ingeniería senior para Avalith"));
    assert.ok(text.includes("capacidad"), text);
    assert.ok(text.includes("Avalith"), text);
  });
});

describe("reminderSubject", () => {
  it("prefixes a bare subject and is idempotent across reply prefixes", async () => {
    const { reminderSubject } = await import("@/lib/outreach/subjectRules");
    assert.equal(reminderSubject("Ingenieria para tu equipo"), "Re: Ingenieria para tu equipo");
    for (const s of ["Re: X", "RE: X", "re: X", "Re:X", "RE:X", "re:X", "  Re: X  "]) assert.equal(reminderSubject(s), s.trim().replace(/^re:\s*/i, "Re: "), s);
    assert.equal(reminderSubject(reminderSubject("X")), "Re: X");
  });
  it("never truncates the inherited text", async () => {
    const { reminderSubject } = await import("@/lib/outreach/subjectRules");
    const long = "a".repeat(SUBJECT_MAX_CHARS);
    assert.equal(reminderSubject(long), `Re: ${long}`);
  });
});

// --- the headline form, and the fragment the owner chose ---------------------------------------------------------

/**
 * The owner received "Getnet abre backend y Salesforce en LATAM y España" and said it reads strangely: a news bulletin
 * ABOUT him in the third person, not a line written TO him. The rule text never asked for that — the FIRST shape
 * example was "Affirm suma backend en Card y Fraud", company plus a conjugated verb, and the model copies shapes.
 *
 * Grammar is not regex-detectable in general, so this check is deliberately high-precision rather than complete: a
 * company name followed by punctuation or a connector is left alone, because neither makes the company act. Only a
 * BARE word after the name turns the line into a headline.
 */
describe("a subject may not read as a headline about the recipient", () => {
  it("rejects the company as the subject of a verb, naming it in the reason so the retry can fix it", () => {
    for (const [subject, company] of [
      ["Getnet abre backend y Salesforce en LATAM y España", "Getnet"],
      ["Affirm suma backend en Card y Fraud", "Affirm"],
    ] as const) {
      const v = validateSubject(subject, { companyName: company });
      assert.ok(v.some((x) => x.kind === "company_headline"), `not caught: ${subject}`);
      assert.match(describeViolations(v), new RegExp(company), "the retry prompt must name the company it tripped on");
    }
  });

  it("leaves a named company alone when it does not act: a colon or a connector is not a headline", () => {
    // Both exist in production today. A check that rejected these would be worse than the problem it fixes.
    for (const [subject, company] of [
      ["Flybondi: una pregunta sobre ingeniería", "Flybondi"],
      ["Plataforma 10 y el equipo de ingeniería", "Plataforma 10"],
      ["Backend y Salesforce en LATAM y España", "Getnet"],
    ] as const) {
      assert.deepEqual(validateSubject(subject, { companyName: company }), [], `wrongly rejected: ${subject}`);
    }
  });

  it("is inert without a company name, and never fires on a short one", () => {
    assert.deepEqual(validateSubject("Backend y Salesforce en LATAM y España", {}), []);
    assert.deepEqual(validateSubject("Ab abre backend en LATAM y en España hoy", { companyName: "Ab" }), [], "a 2-letter name is too ambiguous to judge");
  });
});

/** The owner picked the neutral fragment over the direct question, so a question mark is a rejection, not a style. */
describe("a subject is a fragment, not a question", () => {
  it("rejects both the Spanish opening mark and the closing one", () => {
    for (const s of ["¿Cómo están cubriendo backend en España?", "Como estan cubriendo backend en Espana?"]) {
      assert.ok(validateSubject(s, {}).some((v) => v.kind === "asks_a_question"), `not caught: ${s}`);
    }
  });

  it("does not fire on a subject that merely mentions a question", () => {
    assert.deepEqual(validateSubject("Flybondi: una pregunta sobre ingeniería", { companyName: "Flybondi" }), []);
  });
});
