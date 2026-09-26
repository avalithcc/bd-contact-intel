/**
 * Unit tests for src/lib/contacts/bdConnections.ts — the "BDs conectados"
 * column (mockups/contacts.html: avatar-stack cell, title tooltip lists
 * every connected BD's full name). Pure grouping/mapping only — no DB —
 * the join itself lives in listQueries.ts#getContactBdConnectionsByIds and
 * isn't unit-tested (same DB-read convention as the rest of listQueries.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBdConnectionSummaries,
  groupBdConnectionsByPerson,
  type BdConnectionRow,
} from "@/lib/contacts/bdConnections";

function row(overrides: Partial<BdConnectionRow> = {}): BdConnectionRow {
  return {
    personId: "p1",
    bdId: "bd1",
    bdName: "Ana Pereyra",
    ...overrides,
  };
}

test("groupBdConnectionsByPerson buckets rows by personId, preserving row order within a bucket", () => {
  const rows = [
    row({ personId: "p1", bdId: "bd1", bdName: "Ana Pereyra" }),
    row({ personId: "p2", bdId: "bd2", bdName: "Juan Martínez" }),
    row({ personId: "p1", bdId: "bd3", bdName: "Cristian Civita" }),
  ];
  const grouped = groupBdConnectionsByPerson(rows);
  assert.deepEqual(
    grouped.get("p1")?.map((r) => r.bdName),
    ["Ana Pereyra", "Cristian Civita"],
  );
  assert.deepEqual(grouped.get("p2")?.map((r) => r.bdName), ["Juan Martínez"]);
});

test("groupBdConnectionsByPerson returns an empty map for no rows", () => {
  assert.equal(groupBdConnectionsByPerson([]).size, 0);
});

test("buildBdConnectionSummaries derives initials per connected BD and a joined tooltip title", () => {
  const rows = [
    row({ personId: "p1", bdId: "bd1", bdName: "Ana Pereyra" }),
    row({ personId: "p1", bdId: "bd3", bdName: "Cristian Civita" }),
  ];
  const grouped = groupBdConnectionsByPerson(rows);
  const summary = buildBdConnectionSummaries(grouped.get("p1") ?? []);
  assert.deepEqual(
    summary.avatars.map((a) => ({ bdId: a.bdId, initials: a.initials })),
    [
      { bdId: "bd1", initials: "AP" },
      { bdId: "bd3", initials: "CC" },
    ],
  );
  assert.equal(summary.title, "Ana Pereyra, Cristian Civita");
});

test("buildBdConnectionSummaries returns an empty summary for a person with no connected BDs", () => {
  const summary = buildBdConnectionSummaries([]);
  assert.deepEqual(summary.avatars, []);
  assert.equal(summary.title, "");
});
