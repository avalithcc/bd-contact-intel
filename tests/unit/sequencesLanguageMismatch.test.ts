import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { complianceRefusal } from "@/lib/sequences/complianceGate";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { memberDraftMismatch } from "@/lib/sequences/audienceCard";
import { languageMismatch, languageToday, pinToStep1 } from "@/lib/sequences/languageMismatch";
import { resolveDraftLanguage } from "@/lib/sequences/languageChoice";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";
import { bulkApprovalGate } from "@/lib/sequences/bulkApprovalGate";
import { bulkBarView } from "@/lib/sequences/bulkBar";
import { gateRows, mismatchedNames, nameList, readyMemberIds } from "@/lib/sequences/detailFlow";
import { evaluatePreSendChecks, HOLD_REASONS } from "@/lib/sequences/preSendChecks";
import { buildMemberAudience } from "@/lib/sequences/audienceView";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";
import type { AudienceLanguage, ComplianceAudienceInputs } from "@/lib/sequences/complianceAudience";

const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
// The footer comes from the real producer, in the language the draft is written in.
const footed = (language: "es" | "en") => {
  const r = appendFooter("Hello Jane.", COMPLIANCE_CONFIG, "miami", language, URL_OK);
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
};

test("the predicate: same language is fine, a different language is flagged with both words", () => {
  assert.equal(languageMismatch("es", "es"), null);
  assert.equal(languageMismatch("en", "en"), null);
  assert.deepEqual(languageMismatch("en", "es"), { draft: "en", now: "es" });
  assert.deepEqual(languageMismatch("es", "en"), { draft: "es", now: "en" });
});

test("a draft whose language is unknown is never flagged, whatever today's language is", () => {
  for (const unknown of [null, undefined, "", "pt", "EN", 7]) assert.equal(languageMismatch(unknown, "es"), null, String(unknown));
});

test("no language today (a contact with no audience) is not a language mismatch: the address gate owns that case", () => {
  assert.equal(languageMismatch("en", null), null);
});

test("a one-off kept for the draft's language makes it match: today's language comes from the resolver, so the choice wins", () => {
  // Audience says es, the draft is en. Before the choice it is flagged; after "Mantener en inglés" (chosen = en) it is not.
  assert.deepEqual(languageMismatch("en", resolveDraftLanguage("es", {})!.language), { draft: "en", now: "es" });
  assert.equal(languageMismatch("en", resolveDraftLanguage("es", { chosen: "en" })!.language), null);
});

test("the reminder is pinned to step 1: today's language for step 2 is the one step 1 was written in, and unknown pins nothing", () => {
  assert.equal(languageToday(1, "es", "en"), "es");
  assert.equal(languageToday(2, "es", "en"), "en");
  assert.equal(languageToday(2, "es", null), null, "step 1 language unknown: the reminder is not flagged");
  assert.equal(languageToday(2, "es", "pt"), null);
});

test("pinning a reminder makes the resolver answer with step 1's language, even against a preference", () => {
  const pinned = pinToStep1({ preferred: "es" }, "en");
  assert.equal(resolveDraftLanguage("es", pinned)!.language, "en");
  assert.equal(resolveDraftLanguage("es", pinToStep1({ preferred: "es" }, null))!.language, "es", "step 1 unknown: unchanged behaviour");
});

test("pinToStep1 never mutates its input: the same call twice gives the same answer", () => {
  const input = Object.freeze({ chosen: "es", preferred: "es" });
  const first = pinToStep1(input, "en");
  const second = pinToStep1(input, "en");
  assert.deepEqual(first, second);
  assert.deepEqual(input, { chosen: "es", preferred: "es" });
});

test("complianceRefusal: wrong_language comes after the address and footer checks, and only when a language is given", () => {
  const es = footed("es");
  assert.equal(complianceRefusal("miami", es, COMPLIANCE_CONFIG), null, "no language given: unchanged");
  assert.equal(complianceRefusal("miami", es, COMPLIANCE_CONFIG, { draft: "es", today: "es" }), null);
  assert.equal(complianceRefusal("miami", es, COMPLIANCE_CONFIG, { draft: "es", today: "en" }), "wrong_language");
  assert.equal(complianceRefusal("miami", es, COMPLIANCE_CONFIG, { draft: null, today: "en" }), null);
  assert.equal(complianceRefusal(null, es, COMPLIANCE_CONFIG, { draft: "es", today: "en" }), "unmapped_market");
  assert.equal(complianceRefusal("miami", "no footer", COMPLIANCE_CONFIG, { draft: "es", today: "en" }), "missing_footer");
});

test("the release re-check holds an approved draft in another language, and knows the reason code", () => {
  assert.ok((HOLD_REASONS as readonly string[]).includes("wrong_language"));
  const facts = (draftLanguage: string | null, today: "es" | "en" | null) => ({
    step: 1 as const, memberState: "approved", draftApproved: true, merged: false, email: "jane@acme.test", hasClientStatus: false, address: "miami" as const,
    body: footed("en"), accountStatus: "connected", activeClaim: null, repliedAt: null, inboundReplyAt: null, lastSyncedAt: null, step1RfcMessageId: null, step1ThreadId: null,
    draftLanguage, languageToday: today,
  });
  const ctx = { now: new Date("2026-10-27T15:00:00Z"), suppression: [] };
  assert.deepEqual(evaluatePreSendChecks(facts("en", "es"), ctx), { ok: false, reason: "wrong_language" });
  assert.deepEqual(evaluatePreSendChecks(facts("en", "en"), ctx), { ok: true });
  assert.deepEqual(evaluatePreSendChecks(facts(null, "es"), ctx), { ok: true }, "unknown draft language is released as before");
});

// --- the card, the dialog and the bulk selection ------------------------------------------------------------------------

const draft = (language: AudienceLanguage | null, over: Partial<DetailDraft> = {}): DetailDraft => ({
  subject: "S", body: "B", edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: new Date("2026-10-11T09:00:00Z"), approvedAt: null, scheduledFor: null, language, ...over,
});
const facts = (over: Partial<ComplianceAudienceInputs> = {}): ComplianceAudienceInputs => ({ mobilePhone: null, phone: null, personCountry: "Argentina", companyCountry: null, postingMarkets: [], rosterCountries: [], ...over });
// The audience is built by the real producer (buildMemberAudience), never by hand.
const member = (id: string, language: AudienceLanguage | null, over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: id, personId: `p-${id}`, state: "drafted", holdReason: null, firstName: "A", lastName: "B", jobTitle: null, company: "Acme", companyKey: "acme",
  email: "a@acme.test", emailVerified: true, openIt: 0, florida: false, leadership: false, lastContactAt: null, repliedAt: null, sentAt: null,
  reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft(language), reminderDraft: null,
  audience: buildMemberAudience(facts()), languageChoice: null, preferredLanguage: null, ...over,
});

test("a member card is flagged from the stored draft language against memberLanguage", () => {
  assert.deepEqual(memberDraftMismatch(member("1", "en")), { draft: "en", now: "es" }, "Argentina resolves to Spanish");
  assert.equal(memberDraftMismatch(member("2", "es")), null);
  assert.equal(memberDraftMismatch(member("3", null)), null, "unknown language is not flagged");
  assert.equal(memberDraftMismatch(member("4", "en", { languageChoice: { language: "en", byName: "Ana", at: null } })), null, "kept in English by a person");
  assert.deepEqual(memberDraftMismatch(member("5", "es", { preferredLanguage: { language: "en", byName: "Ana", at: null } })), { draft: "es", now: "en" }, "a preference loaded after generating");
  assert.equal(memberDraftMismatch(member("6", "en", { state: "approved" })), null, "only an unapproved draft is offered the exits; the release re-check holds an approved one");
});

test("readyMemberIds (the set 'Aprobar los N listos' selects) leaves a mismatched draft out, and the others stay", () => {
  const members = [member("ok", "es"), member("wrong", "en"), member("unknown", null)];
  assert.deepEqual(readyMemberIds(members), ["ok", "unknown"]);
});

test("gate rows carry the mismatch, the gate refuses a selection that holds one, and the old review rule still applies", () => {
  const members = [member("ok", "es"), member("wrong", "en"), member("unread", "es", { draft: draft("es", { reviewedAt: null }) })];
  const rows = gateRows(members, ["ok", "wrong", "unread"]);
  assert.deepEqual(rows.map((r) => [r.id, r.reviewed, r.wrongLanguage]), [["ok", true, false], ["wrong", true, true], ["unread", false, false]]);
  const gate = bulkApprovalGate(rows);
  assert.equal(gate.enabled, false);
  assert.deepEqual(gate.wrongLanguageIds, ["wrong"]);
  assert.deepEqual(gate.unreviewedIds, ["unread"], "the review gate is untouched");
  assert.equal(bulkApprovalGate(rows.filter((r) => r.id === "ok")).enabled, true);
  assert.equal(bulkApprovalGate(rows.filter((r) => r.id === "unread")).enabled, false, "still blocked by an unopened draft");
  assert.equal(bulkBarView(rows.filter((r) => r.id === "wrong")).approveEnabled, false);
  assert.deepEqual(bulkBarView(rows).wrongLanguage, 1);
});

test("mismatchedNames names only the unapproved drafts in another language, by person name else email; nameList counts the rest", () => {
  const members = [member("a", "en", { firstName: "Ana", lastName: "Gómez" }), member("b", "es"), member("c", "en", { firstName: null, lastName: null, email: "c@acme.test" }), member("d", "en", { state: "approved" })];
  assert.deepEqual(mismatchedNames(members), { a: "Ana Gómez", c: "c@acme.test" });
  const more = (n: number) => `+${n} more`;
  assert.equal(nameList(["A", "B"], more), "A, B");
  assert.equal(nameList(["A", "B", "C", "D", "E"], more), "A, B, C, +2 more");
});
