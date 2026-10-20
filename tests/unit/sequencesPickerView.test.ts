import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPANY_MEMBER_LIMIT } from "@/lib/sequences/rosterGuards";
import type { SeedCandidate, SeedGuards } from "@/lib/sequences/seedRoster";
import {
  emailBadge, pickerView, staticBlock, toggleAllVisible, toggleOne,
  type PickerContact, type PickerFilter, type Selection,
} from "@/lib/sequences/pickerView";

// Synthetic people only: the approved mockups are invented too, but their data is not copied here.
const contact = (id: string, companyKey: string | null, over: Partial<PickerContact> = {}): PickerContact => ({
  personId: id, name: `Person ${id}`, jobTitle: "Lead", status: "new", company: companyKey && `Co ${companyKey}`, companyKey,
  florida: false, openIt: 2, email: `${id}@x.example`, emailStatus: "verified", emailSource: null, block: null, blockDetail: null, survivorId: null, ...over,
});
const all: PickerFilter = { showBlocked: true };
const sel = (...cs: PickerContact[]): Selection => new Map(cs.map((c) => [c.personId, c]));

test("staticBlock reuses the seed admission and splits only the two reasons the picker words twice", () => {
  const base: SeedCandidate = { personId: "p", label: "p", hasOpenItPosting: true, email: "p@x.example", emailStatus: "verified", emailSource: null, mergedIntoId: null, companyKey: "k", clientStatus: null };
  const guards: SeedGuards = { suppressionRules: [], alreadyMemberPersonIds: new Set(), activeCountByCompany: new Map() };
  const kind = (over: Partial<SeedCandidate>, g: Partial<SeedGuards> = {}) => staticBlock({ ...base, ...over }, { ...guards, ...g });
  assert.equal(kind({}), null);
  assert.equal(kind({ clientStatus: "active" }), "client");
  assert.equal(kind({ clientStatus: "inactive" }), "clientFormer");
  assert.equal(kind({ mergedIntoId: "other" }), "merged");
  assert.equal(kind({ email: null }), "noEmail");
  assert.equal(kind({ emailStatus: "none" }), "unreachable");
  assert.equal(kind({ emailStatus: "probable", emailSource: "pattern_inferred" }), "inferred");
  assert.equal(kind({ hasOpenItPosting: false }), "noPosting");
  assert.equal(kind({ marketMapped: false }), "unmappedMarket");
  assert.equal(kind({ marketMapped: true }), null);
  assert.equal(kind({ marketMapped: false, clientStatus: "active" }), "client");
  assert.equal(kind({}, { alreadyMemberPersonIds: new Set(["p"]) }), "member");
  assert.equal(kind({ email: "gone@x.example" }, { suppressionRules: [{ ruleKind: "address", value: "gone@x.example" }] }), "suppressed");
});

test("emailBadge words the status the way the picker draws it", () => {
  assert.equal(emailBadge("verified", null, "a@x.example"), "verified");
  assert.equal(emailBadge("probable", "hunter", "a@x.example"), "probable");
  assert.equal(emailBadge("probable", "pattern_inferred", "a@x.example"), "inferred");
  assert.equal(emailBadge("none", null, "a@x.example"), "none");
  assert.equal(emailBadge("none", null, null), null);
});

test("the company limit is derived from the selection: a third contact is blocked, freeing one releases it", () => {
  const [a, b, c] = [contact("a", "k"), contact("b", "k"), contact("c", "k")];
  const full = pickerView([a, b, c], sel(a, b), all);
  assert.deepEqual(full.rows.map((r) => [r.contact.personId, r.kind]), [["a", "selected"], ["b", "selected"], ["c", "blocked"]]);
  assert.deepEqual(full.rows[2].limitNames, ["Person a", "Person b"]);
  assert.equal(full.rows[2].block, "companyLimit");
  const freed = pickerView([a, b, c], sel(a), all);
  assert.equal(freed.rows.find((r) => r.contact.personId === "c")!.kind, "available");
  assert.equal(COMPANY_MEMBER_LIMIT, 2);
});

test("blocked contacts go last, after available and selected ones, keeping input order inside each group", () => {
  const v = pickerView([contact("x", "k1", { block: "client" }), contact("a", "k2"), contact("b", "k3")], sel(), all);
  assert.deepEqual(v.rows.map((r) => r.contact.personId), ["a", "b", "x"]);
});

test("counters come from the selection, not from the rows shown: a list that no longer holds the chosen ones changes nothing", () => {
  const [a, b, c] = [contact("a", "k1"), contact("b", "k1"), contact("c", "k2")];
  const selection = sel(a, b, c);
  const v = pickerView([], selection, all);
  assert.equal(v.rows.length, 0);
  assert.deepEqual([v.selectedCount, v.companyCount], [3, 2]);
  assert.deepEqual(v.full, [{ company: "Co k1", count: 2 }]);
  // A chosen contact that is no longer in the loaded list still counts, and still holds its company slot.
  const out = pickerView([contact("z", "k2")], sel(a, b), all);
  assert.deepEqual([out.selectedCount, out.companyCount], [2, 1]);
  assert.equal(pickerView([contact("n", "k1")], sel(a, b), all).rows[0].kind, "blocked");
});

test("contacts without a company are each their own company", () => {
  const v = pickerView([], sel(contact("a", null), contact("b", null)), all);
  assert.equal(v.companyCount, 2);
});

test("hiding the blocked drops them from the rows and the counters, showing them puts them last", () => {
  const list = [contact("x", "k3", { block: "suppressed" }), contact("a", "k1"), contact("u", "k4", { block: "unmappedMarket" }), contact("b", "k2")];
  const hidden = pickerView(list, sel(), { showBlocked: false });
  assert.deepEqual(hidden.rows.map((r) => r.contact.personId), ["a", "b"]);
  assert.deepEqual([hidden.availableShown, hidden.blockedShown], [2, 0]);
  const shown = pickerView(list, sel(), all);
  assert.deepEqual(shown.rows.map((r) => [r.contact.personId, r.kind, r.block]), [["a", "available", null], ["b", "available", null], ["x", "blocked", "suppressed"], ["u", "blocked", "unmappedMarket"]]);
  assert.equal(shown.blockedShown, 2);
});

test("per-row company count is the number selected in that company", () => {
  const [a, b] = [contact("a", "k"), contact("b", "k")];
  assert.deepEqual(pickerView([a, b], sel(a), all).rows.map((r) => r.inCompany), [1, 1]);
});

test("toggleOne adds, removes, and refuses a blocked or over-limit contact without a silent change", () => {
  const [a, b, c] = [contact("a", "k"), contact("b", "k"), contact("c", "k")];
  const s1 = toggleOne(sel(), a);
  assert.deepEqual([...s1.keys()], ["a"]);
  assert.deepEqual([...toggleOne(s1, a).keys()], []);
  const full = sel(a, b);
  assert.equal(toggleOne(full, c), full);
  const blocked = contact("x", "k9", { block: "client" });
  assert.equal(toggleOne(sel(), blocked).size, 0);
});

test("toggleAllVisible adds the available ones in order within the limit, and a second press clears just those", () => {
  const list = [contact("a", "k"), contact("b", "k"), contact("c", "k"), contact("d", "j")];
  const rows = () => pickerView(list, sel(), all).rows;
  const first = toggleAllVisible(sel(), rows());
  assert.deepEqual([...first.keys()], ["a", "b", "d"]);
  // "c" was not dropped silently: it now reads as blocked by the company limit.
  assert.equal(pickerView(list, first, all).rows.find((r) => r.contact.personId === "c")!.kind, "blocked");
  const second = toggleAllVisible(first, pickerView(list, first, all).rows);
  assert.deepEqual([...second.keys()], []);
  const keepOutside = toggleAllVisible(sel(contact("z", "q")), pickerView([list[3]], sel(), all).rows);
  assert.deepEqual([...keepOutside.keys()], ["z", "d"]);
});
