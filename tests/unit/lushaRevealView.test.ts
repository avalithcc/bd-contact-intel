/**
 * The view model behind the Lusha control on the Contact record (task 6.7): every state the approved mockup draws,
 * plus the settled behaviours of PRs 4-5 that the mockup leaves to prose. Pure: no DB, no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LushaConfigResult } from "@/lib/lusha/config";
import { buildLushaView, type ViewPerson } from "@/lib/lusha/revealView";
import type { LatestRows, LedgerRow } from "@/lib/lusha/revealState";

const ON: LushaConfigResult = { ok: true, config: { apiKey: "k" } };
const EMPTY: ViewPerson = { email: null, emailStatus: "none", emailSource: null, phone: null, mobilePhone: null };
const CRM = { name: "Julián Marchetti", company: "Aument", domain: "aument.io", linkedin: null };
const LUSHA = { name: "Julian Marchetti", company: "Aumenta GT", domain: "www.aumenta.do", linkedin: null };
const row = (over: Partial<LedgerRow>): LedgerRow => ({ id: "r", searchId: "s1", at: new Date("2026-10-14T15:00:00Z"), field: "search", state: "settled", outcome: null, value: null, payload: {}, ...over });
const SEARCH = row({ id: "s1", outcome: "matched", payload: { identity: LUSHA, canReveal: [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }] } });
const build = (rows: LatestRows, over: { person?: Partial<ViewPerson>; spent?: number; config?: LushaConfigResult } = {}) =>
  buildLushaView({ config: over.config ?? ON, rows, spentToday: over.spent ?? 0, cap: 12, person: { ...EMPTY, ...over.person }, crm: CRM, companyHref: "/companies/aument", formatDay: () => "14 oct" })!;
const ctl = (v: ReturnType<typeof build>, f: "emails" | "phones") => v[f].control && [v[f].control!.kind, v[f].control!.price, v[f].control!.disabled];

test("outside production nothing is built at all", () => {
  assert.equal(buildLushaView({ config: { ok: false, reason: "not_production" }, rows: {}, spentToday: 0, cap: 12, person: EMPTY, crm: CRM, companyHref: null, formatDay: () => "" }), null);
});

test("state 10: without the key both controls are disabled, unpriced, and only the email row names the variable", () => {
  const v = build({}, { config: { ok: false, reason: "missing_env", missing: ["LUSHA_API_KEY"] } });
  assert.deepEqual([ctl(v, "emails"), ctl(v, "phones"), v.emails.note, v.phones.note], [["search", null, true], ["search", null, true], "unconfigured", null]);
});

test("state 1: an empty Contact is offered both fields at the search-inclusive estimate (~2 and ~6)", () => {
  const v = build({});
  assert.deepEqual([ctl(v, "emails"), ctl(v, "phones"), v.emails.hint, v.emails.note], [["search", 2, false], ["search", 6, false], "search", null]);
});

test("a Contact that can already be sequenced is never offered an email purchase; the phone stays independent", () => {
  const v = build({}, { person: { email: "a@b.co", emailStatus: "verified", emailSource: "hunter" } });
  assert.deepEqual([v.emails.control, ctl(v, "phones")], [null, ["search", 6, false]]);
});

test("a Contact that already holds a phone is flagged so the confirmations can warn that Lusha may return the same number", () => {
  assert.deepEqual([build({}).holdsPhone, build({}, { person: { phone: "+54 11 1111 1111" } }).holdsPhone, build({}, { person: { mobilePhone: "+54 9 11 2222 2222" } }).holdsPhone], [false, true, true]);
});

test("a Contact holding both phone columns is not offered a phone purchase", () => {
  assert.equal(build({}, { person: { phone: "+54 11 1111 1111", mobilePhone: "+54 9 11 2222 2222" } }).phones.control, null);
});

test("state 3: a paid match offers each field at its own price, both read the same search, and the stored match is exposed", () => {
  const v = build({ search: SEARCH });
  assert.deepEqual([ctl(v, "emails"), ctl(v, "phones"), v.emails.hint, v.match], [["reveal", 1, false], ["reveal", 5, false], "paid", LUSHA]);
});

test("state 4: once the email was revealed from this search the phone hint says the identity was already confirmed", () => {
  const email = row({ id: "e1", field: "emails", outcome: "revealed", value: "v@x.co" });
  const v = build({ search: SEARCH, emails: email }, { person: { email: "v@x.co", emailStatus: "probable", emailSource: "lusha" } });
  assert.deepEqual([ctl(v, "phones"), v.phones.hint, v.phones.confirmed], [["reveal", 5, false], "paidConfirmed", true]);
});

test("state 5: no email offers only an explicit re-search at 1 credit, while the phone keeps its own purchase", () => {
  const v = build({ search: SEARCH, emails: row({ id: "e1", field: "emails", outcome: "no_value" }) });
  assert.deepEqual([ctl(v, "emails"), v.emails.note, v.emails.hint, ctl(v, "phones"), v.phones.hint], [["research", 1, false], "no_value", "same", ["reveal", 5, false], "paidAvailable"]);
});

test("state 6: a rejected match offers 'buscar de nuevo' and names what was rejected", () => {
  const v = build({ search: { ...SEARCH, outcome: "match_rejected" } });
  assert.deepEqual([ctl(v, "emails"), v.emails.note, v.matchLabel, v.match], [["research", 1, false], "rejected", "Aumenta GT · www.aumenta.do", null]);
});

test("no match at all is also re-searchable by hand", () => {
  const v = build({ search: row({ id: "s1", outcome: "no_match" }) });
  assert.deepEqual([ctl(v, "emails"), v.emails.note], [["research", 1, false], "no_match"]);
});

test("state 7: an exhausted day keeps the priced control but disables it and says why", () => {
  const v = build({ search: SEARCH }, { spent: 12 });
  assert.deepEqual([ctl(v, "emails"), ctl(v, "phones"), v.emails.note, v.cap, v.spent], [["reveal", 1, true], ["reveal", 5, true], "capped", 12, 12]);
  assert.deepEqual(ctl(build({}, { spent: 12 }), "phones"), ["search", 6, true]);
});

test("state 9c: compliance blocks the whole Contact, both fields, with no control", () => {
  const v = build({ search: SEARCH, complianceBlocked: true });
  assert.deepEqual([v.emails.control, v.phones.control, v.emails.note, v.phones.note], [null, null, "blocked", "blocked"]);
});

test("a phone Lusha returned that the Contact already held is explained and not offered again", () => {
  const v = build({ search: SEARCH, phones: row({ id: "p1", field: "phones", outcome: "already_held" }) });
  assert.deepEqual([v.phones.control, v.phones.note], [null, "already_held"]);
});

test("after a paid call of unknown outcome the reveal is not offered, only an explicit re-search", () => {
  const v = build({ search: SEARCH, emails: row({ id: "e1", field: "emails", state: "failed", errorCode: "outcome_unknown" }) });
  assert.deepEqual([ctl(v, "emails"), v.emails.note, ctl(v, "phones")], [["research", 1, false], "outcome_unknown", ["reveal", 5, false]]);
});

test("state 4: a revealed email carries who and when; a revealed phone is located by its digits", () => {
  const email = row({ id: "e1", field: "emails", outcome: "revealed", value: "v@x.co", actorName: "Cristian Civita", settledAt: new Date("2026-10-14T15:00:00Z"), twin: { id: "t1", name: "Vale Rojas" } });
  const phone = row({ id: "p1", field: "phones", outcome: "revealed", value: "+54 9 11 4123 4567", actorName: "Cristian Civita", settledAt: new Date("2026-10-14T15:00:00Z") });
  const v = build({ search: SEARCH, emails: email, phones: phone }, { person: { email: "v@x.co", emailStatus: "probable", emailSource: "lusha", mobilePhone: "5491141234567" } });
  assert.deepEqual(v.emails.revealed, { by: "Cristian Civita", at: "14 oct", column: "email" });
  assert.deepEqual(v.phones.revealed, { by: "Cristian Civita", at: "14 oct", column: "mobilePhone" });
  assert.deepEqual([v.emails.control, v.phones.control, v.emails.twin], [null, null, { id: "t1", name: "Vale Rojas" }]);
});

test("task 6.11: a paid value the Contact never received offers the free apply, never a second purchase", () => {
  const stuck = row({ id: "e1", field: "emails", outcome: "revealed", value: "v@x.co", errorCode: "write_failed" });
  const v = build({ search: SEARCH, emails: stuck });
  assert.deepEqual([ctl(v, "emails"), v.emails.note, v.emails.revealed], [["apply", null, false], "write_failed", null]);
});

test("a paid value parked by a failed settle offers the free apply, never a second purchase", () => {
  const parked = row({ id: "e1", field: "emails", state: "failed", errorCode: "settle_failed", payload: { emails: [{ email: "v@x.co" }] } });
  const v = build({ search: SEARCH, emails: parked });
  assert.deepEqual([ctl(v, "emails"), v.emails.note], [["apply", null, false], "write_failed"]);
});

test("a match with no readable identity is never offered for a paid reveal, and the confirmed search id is exposed", () => {
  const blank = build({ search: { ...SEARCH, payload: { canReveal: SEARCH.payload && (SEARCH.payload as { canReveal: unknown }).canReveal } } });
  assert.deepEqual([blank.emails.control, blank.emails.note], [null, "not_revealable"]);
  assert.equal(build({ search: SEARCH }).matchSearchId, "s1");
});

test("a revealed value whose column no longer holds it shows no Lusha badge", () => {
  const email = row({ id: "e1", field: "emails", outcome: "revealed", value: "v@x.co" });
  assert.equal(build({ search: SEARCH, emails: email }, { person: { email: "other@x.co", emailStatus: "verified", emailSource: "manual" } }).emails.revealed, null);
});
