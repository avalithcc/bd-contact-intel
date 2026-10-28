/**
 * Three defects of the outreach prompt, measured in production on 2026-10-28:
 * (1) every email was double-signed (body sign-off + the BD's appended signature), (2) every subject was one template
 * describing what WE sell, (3) four subjects sold Avalith to Avalith because the prompt never learned the recipient's
 * company name. Each test names the mutation it catches.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutreachMessagePrompt, type BuildOutreachMessagePromptInput } from "@/lib/outreach/messagePrompt";
import { buildSequenceDraftInput } from "@/lib/sequences/draftInput";
import { signatureWillFollow } from "@/lib/signature/compose";
import { CASES } from "./fixtures/messagePromptCases";

const EMAIL = CASES["email-es-cold"];
const SIGN_OFF_LINE = "Cristian Civita, COO de Avalith";
const exemplarBody = (system: string) => system.slice(system.indexOf("Reference style"));
/**
 * One numbered rule, INCLUDING its indented continuation lines: rules 12 and 13 both carry `   - ` sub-bullets, so a
 * one-line `find` silently returned just the lead-in and every assertion about a sub-bullet passed vacuously.
 */
const rule = (system: string, n: number) => {
  const lines = system.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${n}. `));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^\d+\. /.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
};

test("email with signatureFollows: rule 11 forbids a sign-off and the exemplar body ends at the closing ask", () => {
  const { system } = buildOutreachMessagePrompt({ ...EMAIL, signatureFollows: true });
  assert.match(rule(system, 11), /Do NOT sign off/);
  assert.ok(!rule(system, 11).includes(SIGN_OFF_LINE), "rule 11 must not hand the model a name line to write");
  assert.ok(!exemplarBody(system).includes(SIGN_OFF_LINE), "the exemplar must not end with a sender name line");
  assert.match(exemplarBody(system), /en alguna oportunidad\?"\}/);
  assert.match(rule(system, 12), /ending with the closing ask\./);
  // Mutation caught: leaving rule 11 or the exemplar on the sign-off path while the flag is on.
});

test("email with signatureFollows in English: the English exemplar also ends at the closing ask", () => {
  const { system } = buildOutreachMessagePrompt({ ...EMAIL, language: "en", senderTitle: "COO at Avalith", signatureFollows: true });
  assert.ok(!exemplarBody(system).includes("Cristian Civita, COO at Avalith"));
  assert.match(exemplarBody(system), /make sense\?"\}/);
  // Mutation caught: only the Spanish exemplar threaded with the flag.
});

for (const flag of [false, undefined]) {
  test(`email with signatureFollows ${flag === undefined ? "absent" : "false"}: rule 11 and the exemplar keep the sign-off`, () => {
    const { system } = buildOutreachMessagePrompt({ ...EMAIL, signatureFollows: flag });
    assert.equal(rule(system, 11), `11. Sign off with the sender's name only: "${SIGN_OFF_LINE}". Do not add a generic closing line like "Saludos" beyond the name itself if the reference style doesn't need it.`);
    assert.match(exemplarBody(system), /en alguna oportunidad\?\\n\\nCristian Civita, COO de Avalith"\}/);
    assert.match(rule(system, 12), /ending with the sign-off\./);
    // Mutation caught: defaulting the flag to true, or dropping the sign-off for every email.
  });
}

test("signatureFollows on a LinkedIn DM renders exactly what the LinkedIn default renders", () => {
  for (const name of ["linkedin-es-cold", "linkedin-es-full"]) {
    const base = CASES[name];
    assert.deepEqual(buildOutreachMessagePrompt({ ...base, signatureFollows: true }), buildOutreachMessagePrompt(base));
  }
  const { system } = buildOutreachMessagePrompt({ ...CASES["linkedin-es-cold"], signatureFollows: true });
  assert.match(rule(system, 11), /Sign off with the sender's name only/);
  // Mutation caught: honouring the flag on a channel that never gets a signature appended.
});

test("the planner-style call is pure: the same input rendered twice gives the same prompt and the input is untouched", () => {
  const input: BuildOutreachMessagePromptInput = { ...EMAIL, signatureFollows: true, notes: ["a note"] };
  const before = JSON.stringify(input);
  assert.deepEqual(buildOutreachMessagePrompt(input), buildOutreachMessagePrompt(input));
  assert.equal(JSON.stringify(input), before);
});

test("no company name and no postings: no Company line, no 'unknown' token, and Avalith's name is barred as the recipient's", () => {
  const input: BuildOutreachMessagePromptInput = { ...EMAIL, contact: { ...EMAIL.contact, companyName: null }, company: null };
  const { prompt } = buildOutreachMessagePrompt(input);
  assert.ok(!/^Company:/m.test(prompt), "a company we do not know must be absent, not a stand-in");
  assert.match(prompt, /company name is not on file/);
  assert.match(prompt, /never use Avalith's own name as if it were the recipient's company/);
  // Scoped to the hiring block on purpose. Asserting no "unknown" over the WHOLE prompt passed only because this
  // fixture fills position and connectedOn — those lines print their own "unknown" and are unrelated to this fix, so
  // the broad version would fail for the wrong reason the day a fixture drops a position.
  const block = prompt.slice(prompt.indexOf("Company hiring signal:"), prompt.indexOf("No prior LinkedIn conversation"));
  assert.ok(block.length > 0, "the hiring block moved: this test can no longer see it");
  assert.ok(!/unknown/i.test(block), "no sentinel the model could echo as a company name");
  // Mutation caught: restoring `?? "unknown"`, or emitting an empty `Company:` line.
});

test("the Lemon Cash case: a person with a company name but no postings lookup renders that real name", () => {
  const input: BuildOutreachMessagePromptInput = { ...EMAIL, contact: { ...EMAIL.contact, companyName: "Lemon Cash" }, company: null };
  const { prompt } = buildOutreachMessagePrompt(input);
  assert.match(prompt, /Company hiring signal:\nCompany: Lemon Cash\nNo open IT job posting data/);
  assert.ok(!prompt.includes("not on file"));
  // Mutation caught: ignoring contact.companyName when the postings lookup returns null (the four-email bug).
});

test("postings data wins over the person's recorded company name", () => {
  const { prompt } = buildOutreachMessagePrompt({ ...CASES["email-es-full"], contact: { ...CASES["email-es-full"].contact, companyName: "Some Other Name" } });
  assert.match(prompt, /Company: Affirm\n/);
  assert.ok(!prompt.includes("Some Other Name"));
  // Mutation caught: swapping the precedence of the two names.
});

test("a blank displayName falls through to the person's company, then to absence, with and without postings", () => {
  const full = CASES["email-es-full"];
  const blank = { ...full.company!, displayName: "   " };
  const fallsToPerson = buildOutreachMessagePrompt({ ...full, company: blank, contact: { ...full.contact, companyName: "Lemon Cash" } }).prompt;
  assert.match(fallsToPerson, /\nCompany: Lemon Cash\nTotal open IT postings: 105/);
  const absent = buildOutreachMessagePrompt({ ...full, company: blank, contact: { ...full.contact, companyName: "  " } }).prompt;
  assert.ok(!/^Company:/m.test(absent), "a whitespace name must not print an empty Company line");
  assert.match(absent, /company name is not on file/);
  assert.match(absent, /Total open IT postings: 105/, "the posting data itself is still rendered");
  const noPostings = buildOutreachMessagePrompt({ ...full, company: { ...blank, totalCount: 0 }, contact: { ...full.contact, companyName: null } }).prompt;
  assert.ok(!/^Company:/m.test(noPostings));
  // Mutation caught: printing `Company: ` for a blank name in either branch.
});

test("the subject rule bars Avalith, caps the length, and bans the vendor vocabulary", () => {
  const subjectRule = rule(buildOutreachMessagePrompt(EMAIL).system, 12);
  assert.match(subjectRule, /NEVER name Avalith, and never name the sender, in the subject/);
  assert.match(subjectRule, /35-50 characters, never over 60/);
  for (const word of ["capacidad senior", "staff augmentation", "squads", "nearshore", "soluciones", "oportunidad", "propuesta", "servicios", "solutions", "opportunity", "proposal", "services"]) {
    assert.ok(subjectRule.includes(`"${word}"`) || subjectRule.includes(`"senior ${word}"`), `vendor word missing from the subject rule: ${word}`);
  }
  assert.match(subjectRule, /no "X para tu equipo", no "X para <company>"/);
  assert.match(subjectRule, /never fall back to Avalith's name/);
  // Every shape example must itself obey the 35-50 rule stated two lines above it: the model copies shapes, so an
  // out-of-band example teaches out-of-band subjects. One of the three shipped at 31 characters.
  const examples = [...subjectRule.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((s) => /^(Affirm|Backend|Los roles)/.test(s));
  assert.equal(examples.length, 3, "the three shape examples moved or were renamed");
  for (const e of examples) assert.ok(e.length >= 35 && e.length <= 50, `shape example out of its own 35-50 band (${e.length}): ${e}`);
  // Mutation caught: restoring the one-clause subject rule, or dropping any listed word.
});

test("subject examples and exemplar subjects stay on Affirm and never name a real prospect or the vendor service", () => {
  for (const language of ["es", "en"] as const) {
    const { system } = buildOutreachMessagePrompt({ ...EMAIL, language });
    const subject = /\{"subject": "([^"]+)"/.exec(system)![1];
    assert.ok(!/nearshore|squads|avalith|capacidad/i.test(subject), `exemplar subject sells the vendor: ${subject}`);
    for (const prospect of ["Nubank", "Twilio", "Snowflake", "Upshop", "Mastercard"]) {
      assert.ok(!system.includes(prospect), `${prospect} must never be named in the prompt`);
    }
    // The denylist above only knows the names that were live when this was written. The invariant that survives a new
    // one is positional: the subject rule stays anchored on Affirm and names no company Avalith actually works with,
    // since rules 5 and 10 forbid inventing clients and a name listed as a SHAPE reads to the model like a fact.
    const subjectRule = rule(system, 12);
    assert.ok(subjectRule.includes("Affirm"), "the shape examples lost their anchor company");
    for (const client of ["Mercado Libre", "Accenture", "CookUnity", "Global Hitss", "GlobalLogic", "Jampp", "MODO", "Ualá"]) {
      assert.ok(!subjectRule.includes(client), `a real Avalith client must not appear as a subject shape: ${client}`);
    }
  }
  // Mutation caught: a real prospect name or the old "Squads senior nearshore" exemplar subject creeping back.
});

test("buildSequenceDraftInput sets signatureFollows from its own parameter, never from a stray value on args", () => {
  const audience = { language: "es", address: { name: "x", street: "x", city: "x", country: "x" }, region: "latam" } as never;
  const args = { person: { firstName: "A", lastName: "B", jobTitle: null, roleGroup: null, industry: null, companyKey: "acme", company: "Acme Inc" }, connection: null, signalBodies: [], company: null, senderName: "S" };
  const stray = { ...args, signatureFollows: true } as never;
  assert.equal(buildSequenceDraftInput(stray, audience)!.signatureFollows, false);
  assert.equal(buildSequenceDraftInput(args, audience, "first", {}, true)!.signatureFollows, true);
  assert.equal(buildSequenceDraftInput(args, audience, "first", {}, true)!.contact.companyName, "Acme Inc");
  // Mutation caught: spreading args after the explicit value, or dropping person.company on the way to the prompt.
});

test("signatureWillFollow uses the send path's test: a null, empty or fully stripped signature is not usable", () => {
  assert.equal(signatureWillFollow(null), false);
  assert.equal(signatureWillFollow(undefined), false);
  assert.equal(signatureWillFollow(""), false);
  assert.equal(signatureWillFollow("<script>alert(1)</script>"), false);
  assert.equal(signatureWillFollow("<div>Cristian Civita</div>"), true);
  // Mutation caught: testing the raw string for truthiness instead of the sanitized result.
});
