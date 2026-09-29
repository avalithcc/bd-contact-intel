import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapInlineDerivedColumns,
  type InlineDerivedRawRow,
  type InlineLastActivityRaw,
} from "@/lib/contacts/inlineDerivedColumns";
import {
  buildBdConnectionSummaries,
  groupBdConnectionsByPerson,
  type BdConnectionRow,
} from "@/lib/contacts/bdConnections";
import { buildLastActivityEntries, type LastActivityRawRow } from "@/lib/contacts/lastActivity";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

const dict = t(DEFAULT_LOCALE);

/**
 * PR #196 folded the "BDs conectados"/"Última actividad" reads into
 * `getContactListPage`'s single rows query (`bdConnectionsRaw`/
 * `lastActivityRaw`, correlated-subquery JSON columns) — this module is the
 * DB-free mapping from that raw shape to `ContactListRow`, split out of
 * listQueries.ts (which throws without `DATABASE_URL`) so it's testable.
 * `attachDerivedColumns` (still in listQueries.ts) builds the SAME fields
 * from a batched (not inline) query shape via the same pure helpers
 * (`buildBdConnectionSummaries`, `buildLastActivityEntries`) — the parity
 * test at the bottom pins that the two paths can never disagree.
 */

type BaseRow = Omit<InlineDerivedRawRow, "bdConnectionsRaw" | "lastActivityRaw" | "companyCanonicalName">;

function baseRow(overrides: Partial<BaseRow> & { id: string }): BaseRow {
  return {
    firstName: "Ana",
    lastName: "Pereyra",
    jobTitle: "BD",
    company: "Acme",
    companyKey: "acme",
    ownerBdId: "bd-owner",
    ownerName: "Owner",
    status: "contacted",
    email: "ana@acme.com",
    emailStatus: "verified",
    roleGroup: null,
    industry: null,
    country: null,
    sourceKey: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    seniority: null,
    phone: null,
    mobilePhone: null,
    ...overrides,
  };
}

function rowWith(
  overrides: Partial<BaseRow> & { id: string },
  bdConnectionsRaw: BdConnectionRow[] | null,
  lastActivityRaw: InlineLastActivityRaw | null,
): InlineDerivedRawRow {
  // `companyCanonicalName` is always resolved away by `withResolvedCompanyName`
  // before `mapInlineDerivedColumns` runs in listQueries.ts (see companyDisplayName.ts) —
  // irrelevant to every test in this file, so it's always `null` here.
  return { ...baseRow(overrides), companyCanonicalName: null, bdConnectionsRaw, lastActivityRaw };
}

// (a) empty connections and null activity.

test("mapInlineDerivedColumns: empty bdConnectionsRaw array yields the empty summary, not a crash", () => {
  const [row] = mapInlineDerivedColumns([rowWith({ id: "p1" }, [], null)], dict);
  assert.deepEqual(row.bdConnections, { avatars: [], title: "" });
  assert.equal(row.lastActivity, null);
});

test("mapInlineDerivedColumns: null bdConnectionsRaw (no matching person_bd_connection rows) also yields the empty summary", () => {
  const [row] = mapInlineDerivedColumns([rowWith({ id: "p1" }, null, null)], dict);
  assert.deepEqual(row.bdConnections, { avatars: [], title: "" });
});

// (b) several connections — order and grouping.

test("mapInlineDerivedColumns: preserves the SQL's bd_id order in avatars and the title's comma-join", () => {
  const connections: BdConnectionRow[] = [
    { personId: "p1", bdId: "bd1", bdName: "Ana Pereyra" },
    { personId: "p1", bdId: "bd2", bdName: "Juan Martínez" },
    { personId: "p1", bdId: "bd3", bdName: "Cristian Civita" },
  ];
  const [row] = mapInlineDerivedColumns([rowWith({ id: "p1" }, connections, null)], dict);
  assert.deepEqual(
    row.bdConnections.avatars.map((a) => a.bdId),
    ["bd1", "bd2", "bd3"],
  );
  assert.equal(row.bdConnections.title, "Ana Pereyra, Juan Martínez, Cristian Civita");
});

test("mapInlineDerivedColumns: each row's connections stay scoped to its own person, never leaking across rows", () => {
  const rows = mapInlineDerivedColumns(
    [
      rowWith({ id: "p1" }, [{ personId: "p1", bdId: "bd1", bdName: "Ana" }], null),
      rowWith({ id: "p2" }, [{ personId: "p2", bdId: "bd2", bdName: "Bea" }], null),
    ],
    dict,
  );
  assert.deepEqual(rows[0].bdConnections.title, "Ana");
  assert.deepEqual(rows[1].bdConnections.title, "Bea");
});

// (c) latest activity — every type the label formatter handles, plus the
// two "createdAt as a wire string" shapes postgres-js can hand back.

const ACTIVITY_LABEL_CASES: Array<{ raw: InlineLastActivityRaw; expectedLabel: string }> = [
  { raw: { type: "email_sent", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityEmailSent },
  { raw: { type: "meeting_logged", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityMeetingLogged },
  { raw: { type: "discarded", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityDiscarded },
  { raw: { type: "note", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityNote },
  { raw: { type: "hunter_lookup", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityHunterLookup },
  {
    raw: { type: "status_change", metadata: { status: "replied" }, createdAt: "2026-09-20T10:00:00Z" },
    expectedLabel: dict.contactList.lastActivityReplyReceived,
  },
  {
    raw: { type: "status_backfill", metadata: { status: "replied" }, createdAt: "2026-09-20T10:00:00Z" },
    expectedLabel: dict.contactList.lastActivityReplyReceived,
  },
  {
    raw: { type: "status_change", metadata: { status: "contacted" }, createdAt: "2026-09-20T10:00:00Z" },
    expectedLabel: dict.leadStatuses.contacted,
  },
  {
    raw: { type: "status_change", metadata: {}, createdAt: "2026-09-20T10:00:00Z" },
    expectedLabel: dict.contactList.lastActivityStatusChanged,
  },
  { raw: { type: "some_future_type", metadata: {}, createdAt: "2026-09-20T10:00:00Z" }, expectedLabel: dict.contactList.lastActivityStatusChanged },
];

for (const { raw, expectedLabel } of ACTIVITY_LABEL_CASES) {
  test(`mapInlineDerivedColumns: labels a "${raw.type}" activity (metadata=${JSON.stringify(raw.metadata)}) as "${expectedLabel}"`, () => {
    const [row] = mapInlineDerivedColumns([rowWith({ id: "p1" }, [], raw)], dict);
    assert.equal(row.lastActivity?.label, expectedLabel);
    assert.equal(row.lastActivity?.type, raw.type);
  });
}

test("mapInlineDerivedColumns: createdAt as a Z-suffixed ISO string parses to the exact UTC instant", () => {
  const [row] = mapInlineDerivedColumns(
    [rowWith({ id: "p1" }, [], { type: "email_sent", metadata: {}, createdAt: "2026-09-25T13:30:00Z" })],
    dict,
  );
  assert.equal(row.lastActivity?.createdAt.getTime(), Date.UTC(2026, 8, 25, 13, 30, 0));
});

test("mapInlineDerivedColumns: createdAt as a zone-offset ISO string (+00) parses to the exact UTC instant", () => {
  const [row] = mapInlineDerivedColumns(
    [rowWith({ id: "p1" }, [], { type: "email_sent", metadata: {}, createdAt: "2026-09-25T13:30:00+00:00" })],
    dict,
  );
  assert.equal(row.lastActivity?.createdAt.getTime(), Date.UTC(2026, 8, 25, 13, 30, 0));
});

// The real-bug case (task instructions, item 3): `effectiveActivityAtSql()`'s
// `else` branch is `activity.created_at`, a `timestamp WITHOUT time zone`
// column (db/schema.ts) before Postgres's CASE-expression type unification
// promotes it to `timestamptz` — a string with NO trailing `Z`/offset must
// still be interpreted as UTC here, matching `effectiveActivityAtSql()`'s
// "always UTC" contract, regardless of the Node process's own local
// timezone (Vercel prod runs UTC; a contributor's laptop may not).
test("mapInlineDerivedColumns: createdAt with NO trailing Z/offset is interpreted as UTC, not the process's local timezone", () => {
  const [row] = mapInlineDerivedColumns(
    [rowWith({ id: "p1" }, [], { type: "email_sent", metadata: {}, createdAt: "2026-09-29T00:00:00" })],
    dict,
  );
  assert.equal(
    row.lastActivity?.createdAt.getTime(),
    Date.UTC(2026, 8, 29, 0, 0, 0),
    `expected UTC midnight regardless of TZ=${process.env.TZ ?? "(unset)"}`,
  );
});

// (d) parity: for the same underlying data, `mapInlineDerivedColumns`
// (inline JSON columns) and the pure helpers `attachDerivedColumns` batches
// through (`groupBdConnectionsByPerson`, `buildBdConnectionSummaries`,
// `buildLastActivityEntries`) must agree field-for-field.

test("mapInlineDerivedColumns agrees with attachDerivedColumns's own helper chain for the same underlying rows", () => {
  const connectionRows: BdConnectionRow[] = [
    { personId: "p1", bdId: "bd2", bdName: "Bea" },
    { personId: "p1", bdId: "bd1", bdName: "Ana" },
    { personId: "p2", bdId: "bd3", bdName: "Caro" },
  ];
  const activityRows: LastActivityRawRow[] = [
    { personId: "p1", type: "email_sent", metadata: {}, createdAt: "2026-09-20T10:00:00Z" },
    { personId: "p2", type: "status_change", metadata: { status: "replied" }, createdAt: new Date("2026-09-21T11:00:00Z") },
  ];
  const personIds = ["p1", "p2", "p3"]; // p3 has neither connections nor activity.

  // Expected: exactly what attachDerivedColumns computes, via its own real
  // producers — not hand-typed.
  const groupedConnections = groupBdConnectionsByPerson(connectionRows);
  const lastActivityMap = buildLastActivityEntries(activityRows, dict);
  const expected = new Map(
    personIds.map((id) => [
      id,
      {
        bdConnections: groupedConnections.has(id)
          ? buildBdConnectionSummaries(groupedConnections.get(id)!)
          : { avatars: [], title: "" },
        lastActivity: lastActivityMap.get(id) ?? null,
      },
    ]),
  );

  // Actual: the same underlying rows, reshaped into the inline
  // per-row-correlated JSON shape the SQL site produces — built FROM
  // `groupedConnections`/`activityRows`, not duplicated by hand.
  const actualRows = mapInlineDerivedColumns(
    personIds.map((id) => {
      const activity = activityRows.find((r) => r.personId === id) ?? null;
      return rowWith(
        { id },
        groupedConnections.get(id) ?? null,
        activity
          ? {
              type: activity.type,
              metadata: activity.metadata,
              createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : activity.createdAt,
            }
          : null,
      );
    }),
    dict,
  );

  for (const row of actualRows) {
    assert.deepEqual(row.bdConnections, expected.get(row.id)!.bdConnections, `bdConnections mismatch for ${row.id}`);
    assert.deepEqual(row.lastActivity, expected.get(row.id)!.lastActivity, `lastActivity mismatch for ${row.id}`);
  }
});
