import assert from "node:assert/strict";
import { test } from "node:test";
import { groupListRows, type ListDbRow } from "@/lib/sequences/pageReads";
import { resolveScope, scopeView } from "@/lib/sequences/listScope";
import type { SequenceListRow } from "@/lib/sequences/listView";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

const ME = "11111111-1111-4111-8111-111111111111";
const TOMAS = "22222222-2222-4222-8222-222222222222";
const MARTA = "33333333-3333-4333-8333-333333333333";
const admin = { role: "admin" };
const bd = { role: "bd" };

test("a BD is always forced to their own list, whatever the URL says", () => {
  assert.deepEqual(resolveScope(bd, { scope: "all", owner: TOMAS }), { scope: "mine", ownerId: null });
  assert.deepEqual(resolveScope(bd, {}), { scope: "mine", ownerId: null });
});

test("an admin defaults to Mías, opts into Todas, and the owner filter only counts on Todas with a valid id", () => {
  assert.deepEqual(resolveScope(admin, {}), { scope: "mine", ownerId: null });
  assert.deepEqual(resolveScope(admin, { scope: "all" }), { scope: "all", ownerId: null });
  assert.deepEqual(resolveScope(admin, { scope: "all", owner: TOMAS }), { scope: "all", ownerId: TOMAS });
  assert.deepEqual(resolveScope(admin, { owner: TOMAS }), { scope: "mine", ownerId: null });
  assert.deepEqual(resolveScope(admin, { scope: "all", owner: "not-a-uuid" }), { scope: "all", ownerId: null });
  assert.deepEqual(resolveScope(admin, { scope: "bogus" }), { scope: "mine", ownerId: null });
});

const row = (id: string, ownerId: string, ownerName: string, day: number): SequenceListRow => ({
  id, name: `S ${id}`, createdAt: new Date(Date.UTC(2026, 9, day)), dailySendCap: 5, schedule: DEFAULT_SCHEDULE, companies: [], members: [], owner: { id: ownerId, name: ownerName },
});
const rows = [row("a", ME, "Lucía", 14), row("b", TOMAS, "Tomás", 13), row("c", ME, "Lucía", 12), row("d", TOMAS, "Tomás", 9), row("e", MARTA, "Marta", 8)];

test("tabs count own and all; Mías shows only the admin's own rows", () => {
  const v = scopeView(rows, ME, { scope: "mine", ownerId: null });
  assert.deepEqual(v.rows.map((r) => r.id), ["a", "c"]);
  assert.deepEqual(v.tabs, { mine: 2, all: 5 });
});

test("Todas shows everyone's; the owner menu lists me first, then by count, with the counts", () => {
  const v = scopeView(rows, ME, { scope: "all", ownerId: null });
  assert.equal(v.rows.length, 5);
  assert.deepEqual(v.owners.map((o) => [o.name, o.count, o.isMe]), [["Lucía", 2, true], ["Tomás", 2, false], ["Marta", 1, false]]);
  assert.equal(v.ownerCount, 3);
  assert.equal(v.chipOwner, null);
});

test("an owner filter narrows Todas and names the chip; an unknown owner is ignored", () => {
  const v = scopeView(rows, ME, { scope: "all", ownerId: TOMAS });
  assert.deepEqual(v.rows.map((r) => r.id), ["b", "d"]);
  assert.deepEqual(v.chipOwner, { id: TOMAS, name: "Tomás", count: 2, isMe: false });
  const unknown = scopeView(rows, ME, { scope: "all", ownerId: "44444444-4444-4444-8444-444444444444" });
  assert.equal(unknown.rows.length, 5);
  assert.equal(unknown.chipOwner, null);
});

test("groupListRows carries the owner when the read selects it, and omits it otherwise", () => {
  const base: ListDbRow = { id: "s1", name: "N", created_at: new Date(), daily_send_cap: 5, schedule: {}, state: null, has_draft: null, scheduled_for: null, company: null };
  assert.equal(groupListRows([base])[0].owner, undefined);
  assert.deepEqual(groupListRows([{ ...base, owner_id: TOMAS, owner_name: "Tomás" }])[0].owner, { id: TOMAS, name: "Tomás" });
});

test("the admin list strings exist in both languages", () => {
  for (const d of [es, en]) {
    const l = d.sequences;
    for (const k of [l.listTabMine, l.listTabAll, l.listTabsLabel, l.listColOwner, l.listOwnerMe, l.listOwnerFilterLabel, l.listAllNote, l.listOwnerNote, l.listRemoveFilter, l.listClearAll, l.listAdminIntroLead, l.listAdminIntroStrong, l.listAdminIntroTail, l.listFooterMine, l.listFooterMineOne, l.listFooterAll, l.listFooterAllOne, l.listFooterOwner, l.listFooterOwnerOne, l.listEmptyMineTitle, l.listEmptyMineBody, l.listSeeAll, l.listEmptyAllTitle]) assert.ok(k.length > 0);
  }
});
