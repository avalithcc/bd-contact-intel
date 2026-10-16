import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canDeleteNote } from "@/lib/activity/noteDelete";
import { buildTimelineEntry } from "@/lib/activity/timelineEntry";
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NoteTombstone } = require("@/app/(app)/contacts/[id]/NoteTombstone") as typeof import("@/app/(app)/contacts/[id]/NoteTombstone");

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = "00000000-0000-4000-8000-0000000000c3";
const note = (over: Record<string, unknown> = {}) => ({ type: "note", actorBdId: AUTHOR, deletedAt: null, ...over });

test("the author may delete their note, an admin may delete anyone's, another BD may not", () => {
  assert.equal(canDeleteNote(note(), { id: AUTHOR, role: "bd" }), true);
  assert.equal(canDeleteNote(note(), { id: ADMIN, role: "admin" }), true);
  assert.equal(canDeleteNote(note(), { id: OTHER, role: "bd" }), false);
});

test("a note with no author (imported) is deletable by an admin only; a deleted note and a non-note are never deletable", () => {
  assert.equal(canDeleteNote(note({ actorBdId: null }), { id: OTHER, role: "bd" }), false);
  assert.equal(canDeleteNote(note({ actorBdId: null }), { id: ADMIN, role: "admin" }), true);
  assert.equal(canDeleteNote(note({ deletedAt: new Date() }), { id: AUTHOR, role: "bd" }), false);
  assert.equal(canDeleteNote(note({ type: "call" }), { id: ADMIN, role: "admin" }), false);
});

const createdAt = new Date("2026-10-15T11:20:00Z");
const deletedAt = new Date("2026-10-15T11:34:00Z");
const SECRET = "wrong company pasted here";
const deletedRow = () => ({ id: "n1", type: "note", createdAt, actorBdId: AUTHOR, actorName: "Ana Test", metadata: { note: SECRET }, deletedAt, deletedByBdId: ADMIN, deletedByName: "Cris Test", deletedByRole: "admin" });

test("a deleted note's entry carries who/when and never its text, while keeping the original time", () => {
  const entry = buildTimelineEntry(deletedRow(), OTHER);
  assert.equal(entry.metadata, null);
  assert.ok(!JSON.stringify(entry).includes(SECRET), "the text must not reach the client");
  assert.deepEqual(entry.deleted, { at: deletedAt, byBdId: ADMIN, byName: "Cris Test", byIsAdmin: true });
  assert.equal(entry.at.getTime(), createdAt.getTime());
  assert.equal(buildTimelineEntry({ ...deletedRow(), deletedAt: null, deletedByBdId: null, deletedByName: null }, AUTHOR).deleted, null);
});

test("a deleted note has no effective activity time (it stops counting as last activity)", () => {
  const row = { id: "n1", type: "note", createdAt, metadata: {} };
  assert.equal(resolveEffectiveActivityAt(row)?.getTime(), createdAt.getTime());
  assert.equal(resolveEffectiveActivityAt({ ...row, deletedAt }), null);
});

test("the company timeline entry withholds a deleted note's text through the same helper and names the deleter", async () => {
  const { buildCompanyTimelineEntry } = await import("@/lib/companies/companyTimelineEntry");
  const raw = { id: "n1", type: "note", at: createdAt, rawCreatedAt: createdAt, metadata: { note: SECRET }, actorBdId: AUTHOR, personId: "p1", deletedAt, deletedByBdId: ADMIN };
  const names = new Map([[AUTHOR, "Ana Test"], [ADMIN, "Cris Test"]]);
  const entry = buildCompanyTimelineEntry(raw, new Map(), names, new Set([ADMIN]));
  assert.equal(entry.metadata, null);
  assert.ok(!JSON.stringify(entry).includes(SECRET));
  assert.deepEqual(entry.deleted, { at: deletedAt, byBdId: ADMIN, byName: "Cris Test", byIsAdmin: true });
  const live = buildCompanyTimelineEntry({ ...raw, deletedAt: null, deletedByBdId: null }, new Map(), names, new Set());
  assert.deepEqual(live.metadata, { note: SECRET });
  assert.equal(live.deleted, null);
});

for (const [name, dict] of [["es", es], ["en", en]] as const) {
  test(`the tombstone names the writer and the deleter and shows no body (${name})`, () => {
    const props = { labels: dict.contactRecord, authorName: "Ana Test", deleterName: "Cris Test", deletedByAdmin: true, writtenAtText: "15 oct, 11:20", deletedAtText: "15 oct, 11:34" };
    const html = renderToStaticMarkup(React.createElement(NoteTombstone, props));
    assert.ok(html.includes(dict.contactRecord.noteDeletedTitle));
    assert.ok(html.includes("Ana Test") && html.includes("Cris Test") && html.includes("15 oct, 11:34"));
    assert.ok(html.includes("tl-card system"));
    assert.ok(html.includes(dict.contactRecord.noteDeletedAdminSuffix), "an admin deleting another BD's note is marked");
    assert.ok(!html.includes("blockquote"));
    const own = renderToStaticMarkup(React.createElement(NoteTombstone, { ...props, deletedByAdmin: false }));
    assert.ok(!own.includes(dict.contactRecord.noteDeletedAdminSuffix));
  });
}
