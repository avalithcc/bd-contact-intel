import assert from "node:assert/strict";
import { test } from "node:test";
import { groupListRows, replyPhrases, toMembership, toPickerContact, type ListDbRow, type PickerDbRow } from "@/lib/sequences/pageReads";
import { listView } from "@/lib/sequences/listView";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { pickerView, toggleOne } from "@/lib/sequences/pickerView";
import { t } from "@/lib/i18n/dictionaries";

const T0 = new Date("2026-10-01T12:00:00Z");
const listRow = (id: string, over: Partial<ListDbRow> = {}): ListDbRow => ({ id, name: `Seq ${id}`, created_at: T0, daily_send_cap: 5, schedule: DEFAULT_SCHEDULE, state: "drafted", has_draft: true, scheduled_for: null, company: "Acme", ...over });

// --- list: the counts are derived from the rows handed in, so the grouping must keep every member -------------------

test("groupListRows keeps EVERY member of every Sequence, so the list's counts are true", () => {
  const rows = [
    ...Array.from({ length: 250 }, (_, i) => listRow("a", { company: `Co ${i}` })),
    listRow("b", { state: "replied" }),
  ];
  const grouped = groupListRows(rows);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].members.length, 250);
  const view = listView(grouped);
  assert.equal(view.rows.find((r) => r.id === "a")?.total, 250);
  assert.equal(view.summary.contacts, 251);
});

test("a Sequence with no members still gets a row, with no members and no companies", () => {
  const [row] = groupListRows([listRow("empty", { state: null, has_draft: null, company: null })]);
  assert.deepEqual(row.members, []);
  assert.deepEqual(row.companies, []);
});

test("companies are the distinct names in roster order, matched without regard to case", () => {
  const [row] = groupListRows([listRow("a", { company: "Beta" }), listRow("a", { company: "alfa" }), listRow("a", { company: "ALFA" }), listRow("a", { company: null }), listRow("a", { company: " Gamma " })]);
  assert.deepEqual(row.companies, ["Beta", "alfa", "Gamma"]);
});

test("a member's draft flag and release instant survive the grouping (the queue foot reads them)", () => {
  const at = new Date("2026-10-02T13:00:00Z");
  const [row] = groupListRows([listRow("a", { state: "approved", has_draft: true, scheduled_for: at }), listRow("a", { state: "drafted", has_draft: false })]);
  assert.deepEqual(row.members, [{ state: "approved", hasDraft: true, scheduledFor: at }, { state: "drafted", hasDraft: false, scheduledFor: null }]);
});

// --- picker: non-addable candidates stay, with a reason ----------------------------------------------------------

const pickerRow = (over: Partial<PickerDbRow> = {}): PickerDbRow => ({
  person_id: "p1", first_name: "Ada", last_name: "Test", email: "ada@acme.test", email_status: "verified", email_source: null, job_title: "CTO", status: "new",
  company: "Acme", company_key: "acme", merged_into_id: null, client_status: null, open_it: 2, is_florida: false, market_mapped: true, ...over,
});
const toContact = (over: Partial<PickerDbRow> = {}, rules: Parameters<typeof toPickerContact>[1] = []) => toPickerContact(pickerRow(over), rules, "Sin nombre");

test("an addable candidate has no block", () => {
  assert.equal(toContact().block, null);
});

test("every static reason survives into the picker instead of being filtered out of the read", () => {
  assert.equal(toContact({ client_status: "active" }).block, "client");
  assert.equal(toContact({ client_status: "inactive" }).block, "clientFormer");
  assert.equal(toContact({ merged_into_id: "survivor" }).block, "merged");
  assert.equal(toContact({ email: null, email_status: "none" }).block, "noEmail");
  assert.equal(toContact({ email: "x@acme.test", email_status: "none" }).block, "unreachable");
  assert.equal(toContact({ email_status: "probable", email_source: "pattern_inferred" }).block, "inferred");
  assert.equal(toContact({ open_it: 0 }).block, null, "no open posting is a filter now, not a reason to block");
  assert.equal(toContact({ market_mapped: false }).block, "unmappedMarket");
  assert.equal(toContact({}, [{ ruleKind: "address", value: "ada@acme.test" }]).block, "suppressed");
  assert.equal(toContact({}, [{ ruleKind: "domain", value: "acme.test" }]).block, "suppressed");
});

test("a merged candidate links to its survivor, and nobody else carries a survivor id", () => {
  assert.equal(toContact({ merged_into_id: "survivor" }).survivorId, "survivor");
  assert.equal(toContact().survivorId, null);
});

test("the guards are empty: a static company_limit can never be handed to the picker (it would render with no names)", () => {
  // Two candidates of one company, neither blocked: the limit is derived from the SELECTION, never stored on a contact.
  const a = toContact({ person_id: "a" });
  const b = toContact({ person_id: "b" });
  const c = toContact({ person_id: "c" });
  assert.equal(a.block, null);
  assert.equal(b.block, null);
  assert.equal(c.block, null);
  let selection = toggleOne(new Map(), a);
  selection = toggleOne(selection, b);
  const view = pickerView([a, b, c], selection, { showBlocked: true });
  const blocked = view.rows.find((r) => r.contact.personId === "c");
  assert.equal(blocked?.block, "companyLimit");
  assert.deepEqual(blocked?.limitNames, [a.name, b.name], "the reason names the two chosen, never an empty list");
});

test("every picker candidate carries a company key, so company-less contacts cannot each count as their own company", () => {
  assert.equal(toContact().companyKey, "acme");
});

test("an unnamed contact gets the caller's label, never an empty name", () => {
  assert.equal(toContact({ first_name: null, last_name: null }).name, "Sin nombre");
  assert.equal(toContact({ first_name: "Ada", last_name: null }).name, "Ada");
});

// --- Contact record: memberships --------------------------------------------------------------------------------

test("a membership is owned by the viewer only when the Sequence's owner is the viewer", () => {
  const row = { member_id: "m", sequence_name: "S", owner_bd_id: "bd1", state: "sent", scheduled_for: null, sent_at: T0, replied_at: null, discarded_at: null, discard_reason: null };
  assert.equal(toMembership(row, "bd1").ownedByViewer, true);
  assert.equal(toMembership(row, "bd2").ownedByViewer, false);
});

// --- advisory opt-out prompt ------------------------------------------------------------------------------------

test("replyPhrases raises the prompt on any reply, keeps the first phrase per member, and never invents one", () => {
  const out = replyPhrases([
    { member_id: "m1", body_text: "Thanks, but please unsubscribe me." },
    { member_id: "m1", body_text: "remove me" },
    { member_id: "m2", body_text: "Sounds interesting, call me Tuesday." },
    { member_id: "m3", body_text: null },
    { member_id: "m4", body_text: "Not now.\n\nOn Mon, Ada wrote:\n> reply with \"unsubscribe\"" },
  ]);
  assert.deepEqual(out, { m1: "unsubscribe" });
});

test("our own footer quoted back in a reply does not raise the prompt", () => {
  const footer = COMPLIANCE_CONFIG.us!.optOutText;
  assert.deepEqual(replyPhrases([{ member_id: "m1", body_text: `Interesting, tell me more.\n\n${footer}` }]), {});
});

test("the dictionary has the label the unnamed contact falls back to", () => {
  assert.ok(t("es").sequences.unnamed.length > 0);
});
