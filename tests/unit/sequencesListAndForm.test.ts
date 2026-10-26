import assert from "node:assert/strict";
import { test } from "node:test";
import { capState, createFormView } from "@/lib/sequences/createForm";
import { companiesLine, createdAgo, createdOn, listView, type SequenceListRow } from "@/lib/sequences/listView";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { es } from "@/lib/i18n/dictionaries/es";
import type { MemberState } from "@/lib/sequences/memberState";

const NOW = new Date("2026-10-15T16:00:00Z");
const m = (state: MemberState, over: { hasDraft?: boolean; scheduledFor?: Date | null } = {}) => ({ state, hasDraft: state !== "drafted" || over.hasDraft !== false, scheduledFor: over.scheduledFor ?? null, sentAt: state === "sent" || state === "replied" || state === "no_reply" ? new Date("2026-10-14T13:00:00Z") : null, discardReason: null });
const row = (id: string, createdAt: string, members: ReturnType<typeof m>[], over: Partial<SequenceListRow> = {}): SequenceListRow =>
  ({ id, name: `Seq ${id}`, createdAt: new Date(createdAt), dailySendCap: 5, schedule: DEFAULT_SCHEDULE, companies: ["A", "B", "C"], members, ...over });

test("cap: the default is valid, above 8 warns, above 15 and non-integers are refused", () => {
  assert.deepEqual(capState("5"), { value: 5, error: null, warn: false });
  assert.deepEqual(capState("8"), { value: 8, error: null, warn: false });
  assert.deepEqual(capState("12"), { value: 12, error: null, warn: true });
  assert.deepEqual(capState("15"), { value: 15, error: null, warn: true });
  assert.deepEqual(capState("20"), { value: null, error: "ceiling", warn: false });
  for (const bad of ["0", "-3", "2.5", "", "abc"]) assert.deepEqual(capState(bad), { value: null, error: "invalid", warn: false }, bad);
});

test("form view: needs a name, a valid cap, an account and at least one contact; the label follows the selection count", () => {
  const ok = { name: " Salud ", cap: "5", selectedCount: 6, hasAccount: true };
  assert.deepEqual(createFormView(ok), { nameMissing: false, cap: capState("5"), submit: "many", blocked: false, valid: true });
  assert.equal(createFormView({ ...ok, selectedCount: 1 }).submit, "one");
  const none = createFormView({ ...ok, selectedCount: 0 });
  assert.deepEqual([none.submit, none.blocked, none.valid], ["none", true, false]);
  assert.equal(createFormView({ ...ok, name: "   " }).valid, false);
  assert.equal(createFormView({ ...ok, name: "   " }).blocked, false);
  assert.equal(createFormView({ ...ok, cap: "99" }).valid, false);
  assert.deepEqual([createFormView({ ...ok, hasAccount: false }).blocked, createFormView({ ...ok, hasAccount: false }).valid], [true, false]);
});

test("list rows: the state badges partition the members, sent excludes replied and removed, and drafts without text are counted", () => {
  const v = listView([row("a", "2026-10-12T15:00:00Z", [m("drafted"), m("drafted", { hasDraft: false }), m("approved"), m("sent"), m("no_reply"), m("replied"), m("discarded")])]);
  const c = v.rows[0].counts;
  assert.deepEqual(c, { review: 1, noDraft: 1, queued: 1, sent: 2, replied: 1, removed: 1 });
  assert.equal(c.review + c.noDraft + c.queued + c.sent + c.replied + c.removed, v.rows[0].total);
  assert.equal(v.rows[0].total, 7);
});

test("list rows: newest first whatever order the read used, and the cap warns only above 8", () => {
  const v = listView([row("old", "2026-09-22T15:00:00Z", [m("sent")]), row("new", "2026-10-14T15:00:00Z", [m("drafted")], { dailySendCap: 10 })]);
  assert.deepEqual(v.rows.map((r) => [r.id, r.capHigh]), [["new", true], ["old", false]]);
});

test("list summary: totals add every sequence, 'in N sequences' counts only those with something to review", () => {
  const a = row("a", "2026-10-12T15:00:00Z", [m("drafted"), m("drafted"), m("approved", { scheduledFor: new Date("2026-10-17T13:00:00Z") })]);
  const b = row("b", "2026-10-14T15:00:00Z", [m("drafted"), m("replied"), m("approved", { scheduledFor: new Date("2026-10-16T13:00:00Z") })]);
  const c = row("c", "2026-09-22T15:00:00Z", [m("sent"), m("replied")]);
  const s = listView([a, b, c]).summary;
  assert.deepEqual([s.sequences, s.contacts, s.review, s.reviewIn, s.queued, s.replied], [3, 8, 3, 2, 2, 2]);
  assert.equal(s.nextReleaseAt?.toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(listView([]).summary.nextReleaseAt, null);
});

test("companies line: names up to two, then how many more; one and two read without a count", () => {
  const l = es.sequences;
  assert.equal(companiesLine(["Alfa"], l), "Alfa");
  assert.equal(companiesLine(["Alfa", "Beta"], l), "Alfa y Beta");
  assert.equal(companiesLine(["Alfa", "Beta", "Gama"], l), "Alfa, Beta y 1 empresa más");
  assert.equal(companiesLine(["Alfa", "Beta", "Gama", "Delta", "Eps"], l), "Alfa, Beta y 3 empresas más");
  assert.equal(companiesLine([], l), "");
});

test("created: the date is Miami's calendar day and the age counts calendar days", () => {
  const l = es.sequences;
  assert.equal(createdOn(new Date("2026-10-12T15:00:00Z"), l), "12 oct 2026");
  // 03:00 UTC on the 13th is still the 12th in Miami.
  assert.equal(createdOn(new Date("2026-10-13T03:00:00Z"), l), "12 oct 2026");
  const ago = (iso: string) => createdAgo(new Date(iso), NOW, l);
  assert.equal(ago("2026-10-15T05:00:00Z"), "hoy");
  assert.equal(ago("2026-10-14T15:00:00Z"), "ayer");
  assert.equal(ago("2026-10-12T15:00:00Z"), "hace 3 días");
  assert.equal(ago("2026-10-08T15:00:00Z"), "hace 1 semana");
  assert.equal(ago("2026-09-22T15:00:00Z"), "hace 3 semanas");
  assert.equal(ago("2026-07-15T15:00:00Z"), "hace 3 meses");
});
