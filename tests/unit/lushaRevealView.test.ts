/**
 * The view model behind the Lusha control on the Contact record (task 6.7): every state the approved mockup draws,
 * plus the settled behaviours of PRs 4-5 that the mockup leaves to prose. Pure: no DB, no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LushaConfigResult } from "@/lib/lusha/config";
import { STRANDED_AFTER_MS } from "@/lib/lusha/revealState";
import { buildLushaView, type ViewPerson } from "@/lib/lusha/revealView";
import type { LatestRows, LedgerRow } from "@/lib/lusha/revealState";

const ON: LushaConfigResult = { ok: true, config: { apiKey: "k" } };
const EMPTY: ViewPerson = { email: null, emailStatus: "none", emailSource: null, phone: null, mobilePhone: null };
const CRM = { name: "Julián Marchetti", company: "Aument", domain: "aument.io", linkedin: null };
const LUSHA = { name: "Julian Marchetti", company: "Aumenta GT", domain: "www.aumenta.do", linkedin: null };
const row = (over: Partial<LedgerRow>): LedgerRow => ({ id: "r", searchId: "s1", at: new Date("2026-10-14T15:00:00Z"), field: "search", state: "settled", outcome: null, value: null, payload: {}, ...over });
const SEARCH = row({ id: "s1", outcome: "matched", payload: { identity: LUSHA, canReveal: [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }] } });
const build = (rows: LatestRows, over: { person?: Partial<ViewPerson>; spent?: number; config?: LushaConfigResult; enabled?: boolean } = {}) =>
  buildLushaView({ config: over.config ?? ON, enabled: over.enabled ?? true, rows, spentToday: over.spent ?? 0, spentCycle: over.spent ?? 0, dailyCap: 12, monthlyCap: 400, cycleEnd: new Date("2026-11-21T03:00:00.000Z"), person: { ...EMPTY, ...over.person }, crm: CRM, companyHref: "/companies/aument", formatDay: () => "14 oct" })!;
const ctl = (v: ReturnType<typeof build>, f: "emails" | "phones") => v[f].control && [v[f].control!.kind, v[f].control!.price, v[f].control!.disabled];

test("outside production nothing is built at all", () => {
  assert.equal(buildLushaView({ config: { ok: false, reason: "not_production" }, enabled: true, rows: {}, spentToday: 0, spentCycle: 0, dailyCap: 12, monthlyCap: 400, cycleEnd: new Date("2026-11-21T03:00:00.000Z"), person: EMPTY, crm: CRM, companyHref: null, formatDay: () => "" }), null);
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
  assert.deepEqual([ctl(v, "emails"), ctl(v, "phones"), v.emails.note, v.dailyCap, v.spentToday], [["reveal", 1, true], ["reveal", 5, true], "capped", 12, 12]);
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

test("lusha-per-bd: a BD with Lusha off gets no button, only the reason, and nothing to confirm", () => {
  const v = build({ search: SEARCH }, { enabled: false });
  assert.deepEqual([v.emails.control, v.phones.control, v.emails.note, v.phones.note, v.match, v.matchSearchId], [null, null, "not_enabled", "not_enabled", null, null]);
  const empty = build({}, { enabled: false });
  assert.deepEqual([empty.emails.control, empty.emails.hint, empty.emails.note], [null, null, "not_enabled"]);
});

test("lusha-per-bd: what was already revealed stays visible, and the free apply stays available, with Lusha off", () => {
  const email = row({ id: "e1", field: "emails", outcome: "revealed", value: "v@x.co", actorName: "Lucia", settledAt: new Date("2026-10-14T15:00:00Z") });
  const v = build({ search: SEARCH, emails: email }, { enabled: false, person: { email: "v@x.co", emailStatus: "probable", emailSource: "lusha" } });
  assert.deepEqual([v.emails.revealed, v.emails.note, v.phones.note], [{ by: "Lucia", at: "14 oct", column: "email" }, null, "not_enabled"]);
  const stuck = row({ id: "e2", field: "emails", outcome: "revealed", value: "v@x.co", errorCode: "write_failed" });
  assert.deepEqual(ctl(build({ search: SEARCH, emails: stuck }, { enabled: false }), "emails"), ["apply", null, false]);
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

// --- a reservation stranded by a killed function must not read as a plain priced reveal ----------------------------------

test("a stranded phones reservation renders the re-search control, never a priced reveal; a fresh one is untouched", () => {
  const at = (ms: number) => new Date(Date.now() - ms);
  const stranded = row({ id: "p1", field: "phones", state: "reserved", at: at(STRANDED_AFTER_MS + 60_000) });
  const v = build({ search: SEARCH, phones: stranded });
  assert.deepEqual([ctl(v, "phones"), v.phones.note], [["research", 1, false], "outcome_unknown"]);
  const fresh = build({ search: SEARCH, phones: row({ id: "p2", field: "phones", state: "reserved", at: at(1000) }) });
  assert.deepEqual(ctl(fresh, "phones"), ["reveal", 5, false], "it may be in flight: unchanged");
});

// --- doNotCall: shown only when the flag is a literal true AND the number on the record is still the revealed one ---------

const PHONE = "+54 9 11 3026-1031";
const phoneRow = (entries: unknown[], value = PHONE) => row({ id: "p1", field: "phones", outcome: "revealed", value, payload: { phones: entries } });
const entry = (over: Record<string, unknown> = {}) => ({ type: "mobile", number: PHONE, ...over });
const flagged = (entries: unknown[], person: Partial<ViewPerson>, value = PHONE) => build({ search: SEARCH, phones: phoneRow(entries, value) }, { person }).phones.revealed;

test("a revealed number flagged doNotCall:true carries the flag while the record still holds it", () => {
  assert.deepEqual(flagged([entry({ doNotCall: true })], { mobilePhone: PHONE })?.doNotCall, true);
});

test("false, a missing field or a non-boolean carry nothing: `false` is not a clearance and nothing is drawn for it", () => {
  for (const odd of [false, undefined, "true", 1, null]) {
    const r = flagged([entry(odd === undefined ? {} : { doNotCall: odd })], { mobilePhone: PHONE });
    assert.ok(r && !("doNotCall" in r), `no key for ${JSON.stringify(odd)}`);
  }
});

test("once a BD edits the number away, the flag no longer describes the record and is not shown", () => {
  const edited = build({ search: SEARCH, phones: phoneRow([entry({ doNotCall: true })]) }, { person: { mobilePhone: "+54 9 11 5555-0000" } });
  assert.equal(edited.phones.revealed, null);
});

test("a number Lusha lists twice, once unflagged and once flagged, is flagged in either order", () => {
  for (const entries of [[entry({ doNotCall: false }), entry({ doNotCall: true })], [entry({ doNotCall: true }), entry({ doNotCall: false })]]) {
    assert.equal(flagged(entries, { mobilePhone: PHONE })?.doNotCall, true);
  }
});

test("the flag of another entry is not borrowed when the ledger value is a different number", () => {
  const other = entry({ number: "+54 11 4000-0001", type: "work", doNotCall: true });
  const r = flagged([other, entry({ doNotCall: false })], { mobilePhone: PHONE });
  assert.ok(r && !("doNotCall" in r), "the held number is the unflagged mobile");
});

test("a flag is exposed for the phone column that holds the number and never for an email", () => {
  const v = build({ search: SEARCH, phones: phoneRow([entry({ doNotCall: true })]) }, { person: { mobilePhone: PHONE } });
  assert.deepEqual([v.phones.revealed?.column, v.phones.revealed?.doNotCall, v.emails.revealed], ["mobilePhone", true, null]);
});

// --- one reveal, two numbers ---------------------------------------------------------------------------------------------

const WORK = "+54 11 4000 0001";
const MOBILE = "+54 9 11 5000 0002";
const twoRow = (work: Record<string, unknown>, mobile: Record<string, unknown>) =>
  row({ id: "p1", field: "phones", outcome: "revealed", value: WORK, actorName: "Cristian Civita", settledAt: new Date("2026-10-14T15:00:00Z"), payload: { phones: [{ number: WORK, type: "work", ...work }, { number: MOBILE, type: "mobile", ...mobile }] } });

test("a reveal that placed BOTH numbers marks both columns, each with its own do-not-call flag", () => {
  const person = { phone: "541140000001", mobilePhone: MOBILE };
  assert.deepEqual(build({ search: SEARCH, phones: twoRow({}, { doNotCall: true }) }, { person }).phones.revealed, { by: "Cristian Civita", at: "14 oct", column: "phone", also: { column: "mobilePhone", doNotCall: true } });
  const v = build({ search: SEARCH, phones: twoRow({ doNotCall: true }, { doNotCall: false }) }, { person });
  assert.deepEqual([v.phones.revealed?.doNotCall, v.phones.revealed?.also], [true, { column: "mobilePhone" }]);
});

test("a second Lusha number the Contact no longer holds, or never got, is not marked", () => {
  const edited = build({ search: SEARCH, phones: twoRow({}, {}) }, { person: { phone: "541140000001", mobilePhone: "+54 9 11 999 9999" } });
  assert.equal(edited.phones.revealed?.also, undefined);
  const unplaced = build({ search: SEARCH, phones: twoRow({}, {}) }, { person: { phone: "+54 11 1111 1111", mobilePhone: "5491150000002" } });
  assert.deepEqual([unplaced.phones.revealed?.column, unplaced.phones.revealed?.also], ["mobilePhone", undefined]);
});

test("an exhausted cycle disables the controls, says it is the monthly cap and when it renews; the daily rail stays 'capped'", () => {
  const monthly = buildLushaView({ config: ON, enabled: true, rows: { search: SEARCH }, spentToday: 1, spentCycle: 399, dailyCap: 60, monthlyCap: 400, cycleEnd: new Date("2026-11-21T03:00:00.000Z"), person: EMPTY, crm: CRM, companyHref: null, formatDay: () => "21 nov" })!;
  assert.deepEqual([ctl(monthly, "phones"), monthly.phones.note, monthly.emails.note, monthly.cycleResetsOn], [["reveal", 5, true], "capped_monthly", null, "21 nov"]);
  const daily = buildLushaView({ config: ON, enabled: true, rows: { search: SEARCH }, spentToday: 58, spentCycle: 100, dailyCap: 60, monthlyCap: 400, cycleEnd: new Date("2026-11-21T03:00:00.000Z"), person: EMPTY, crm: CRM, companyHref: null, formatDay: () => "21 nov" })!;
  assert.deepEqual([daily.phones.note, daily.emails.note], ["capped", null]);
});
