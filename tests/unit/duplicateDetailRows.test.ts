/**
 * Unit tests for src/lib/identity/duplicateDetailRows.ts — the pure assembly
 * of the batched rows behind getDuplicateCandidateDetail. Fixtures use the
 * drizzle row types the real queries return (select() / select({connection,
 * bdName}) / select({id,name})).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleDuplicateDetail, personDisplayName, type DuplicateDetailRows } from "@/lib/identity/duplicateDetailRows";
import { toMergeFields } from "@/lib/identity/mergeDb";

type PersonRow = DuplicateDetailRows["persons"][number];
type ConnRow = DuplicateDetailRows["connections"][number];

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const BD1 = "00000000-0000-4000-8000-0000000000d1";
const BD2 = "00000000-0000-4000-8000-0000000000d2";

function personRow(id: string, over: Partial<PersonRow> = {}): PersonRow {
  const blank = Object.fromEntries(Object.keys(toMergeFields({} as PersonRow)).map((k) => [k, null]));
  return {
    ...blank,
    id,
    firstName: "Jane",
    lastName: "Doe",
    emailStatus: "none",
    status: "new",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ownerBdId: null,
    profileKey: null,
    ...over,
  } as unknown as PersonRow;
}

function conn(personId: string, bdId: string, bdName: string | null, connectedOn: string | null): ConnRow {
  return { connection: { personId, bdId, connectedOn } as ConnRow["connection"], bdName };
}

function rows(over: Partial<DuplicateDetailRows> = {}): DuplicateDetailRows {
  return {
    candidate: { id: "c1", personAId: A, personBId: B, reason: "same_email", matchKey: "k" } as DuplicateDetailRows["candidate"],
    persons: [personRow(A), personRow(B)],
    connections: [],
    owners: [],
    ...over,
  };
}

test("a missing person returns null instead of throwing (page renders 'ya resuelto')", () => {
  assert.equal(assembleDuplicateDetail(rows({ persons: [personRow(A)] })), null);
  assert.equal(assembleDuplicateDetail(rows({ persons: [personRow(B)] })), null);
  assert.equal(assembleDuplicateDetail(rows({ persons: [] })), null);
});

test("displayed connections drop rows without a bd; survivor logic still sees them", () => {
  // B's only connection has no bd row but is the earliest: it must still make B the survivor.
  const detail = assembleDuplicateDetail(
    rows({
      connections: [conn(A, BD1, "Ana", "01 Jun 2025"), conn(B, BD2, null, "01 Jan 2020")],
    }),
  );
  assert.ok(detail);
  assert.deepEqual(detail.personB.connections, []);
  assert.deepEqual(detail.personA.connections, [{ bdName: "Ana", connectedOn: "01 Jun 2025" }]);
  assert.equal(detail.recommendedSurvivor, "b");
  assert.equal(detail.preview.survivorUpdate !== undefined, true);
});

/**
 * The mirror of the test above. The invariant is symmetric but a one-sided fixture is not: with the bd-less row only
 * on B, a mutation that filters A's rows out of the survivor input is INERT (A's row has a bd, so nothing is
 * dropped) and passes clean. With both directions pinned, filtering EITHER side fails.
 */
test("the same holds with the bd-less connection on A: it must still make A the survivor", () => {
  const detail = assembleDuplicateDetail(
    rows({
      connections: [conn(A, BD1, null, "01 Jan 2020"), conn(B, BD2, "Beto", "01 Jun 2025")],
    }),
  );
  assert.ok(detail);
  assert.deepEqual(detail.personA.connections, []);
  assert.deepEqual(detail.personB.connections, [{ bdName: "Beto", connectedOn: "01 Jun 2025" }]);
  assert.equal(detail.recommendedSurvivor, "a");
});

test("connections are split per person", () => {
  const detail = assembleDuplicateDetail(
    rows({ connections: [conn(A, BD1, "Ana", null), conn(B, BD2, "Beto", null), conn(A, BD2, "Beto", null)] }),
  );
  assert.ok(detail);
  assert.equal(detail.personA.connections.length, 2);
  assert.deepEqual(detail.personB.connections, [{ bdName: "Beto", connectedOn: null }]);
});

test("owner names: shared owner, no owner, and an owner id with no bd row", () => {
  const detail = assembleDuplicateDetail(
    rows({
      persons: [personRow(A, { ownerBdId: BD1 }), personRow(B, { ownerBdId: BD1 })],
      owners: [{ id: BD1, name: "Ana" }],
    }),
  );
  assert.ok(detail);
  assert.equal(detail.personA.ownerName, "Ana");
  assert.equal(detail.personB.ownerName, "Ana");

  const none = assembleDuplicateDetail(rows({ persons: [personRow(A, { ownerBdId: BD2 }), personRow(B)] }));
  assert.ok(none);
  assert.equal(none.personA.ownerName, null);
  assert.equal(none.personB.ownerName, null);
});

test("is pure: same input twice gives the same output and the input is untouched", () => {
  const input = rows({ connections: [conn(A, BD1, "Ana", "01 Jun 2025"), conn(B, BD2, null, "01 Jan 2020")] });
  const before = JSON.stringify(input);
  const first = assembleDuplicateDetail(input);
  const second = assembleDuplicateDetail(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
});

// A: which person is the survivor decides whose fields win. Distinct values on every field make a swap of
// survivor/merged in the preview call visible.
test("the preview treats the recommended survivor as the survivor, in both directions", () => {
  const withKey = personRow(A, { profileKey: "in/a", jobTitle: "CEO of A", email: "a@a.test" });
  const without = personRow(B, { jobTitle: "CTO of B", email: "b@b.test" });

  const aWins = assembleDuplicateDetail(rows({ persons: [withKey, without] }));
  assert.ok(aWins);
  assert.equal(aWins.recommendedSurvivor, "a");
  assert.equal(aWins.preview.snapshot.merged.id, B);
  assert.equal(aWins.preview.survivorUpdate.jobTitle, "CEO of A");
  assert.equal(aWins.preview.survivorUpdate.email, "a@a.test");

  const bWins = assembleDuplicateDetail(rows({ persons: [personRow(A, { jobTitle: "CEO of A" }), personRow(B, { profileKey: "in/b", jobTitle: "CTO of B" })] }));
  assert.ok(bWins);
  assert.equal(bWins.recommendedSurvivor, "b");
  assert.equal(bWins.preview.snapshot.merged.id, A);
  assert.equal(bWins.preview.survivorUpdate.jobTitle, "CTO of B");
});

// B: every displayed field of a side, with values that differ from every other field so a swap cannot hide.
test("a side carries each of its own fields", () => {
  const created = new Date("2026-03-04T05:06:07Z");
  const detail = assembleDuplicateDetail(
    rows({
      persons: [
        personRow(A, {
          firstName: "Ada",
          lastName: "Lovelace",
          jobTitle: "job",
          email: "e@x.test",
          emailStatus: "verified",
          profileKey: "in/pk",
          city: "city",
          region: "region",
          country: "country",
          status: "replied",
          createdAt: created,
          ownerBdId: BD1,
        }),
        personRow(B),
      ],
      owners: [{ id: BD1, name: "Ana" }],
    }),
  );
  assert.ok(detail);
  assert.deepEqual(detail.personA, {
    id: A,
    name: "Ada Lovelace",
    jobTitle: "job",
    email: "e@x.test",
    emailStatus: "verified",
    profileKey: "in/pk",
    city: "city",
    region: "region",
    country: "country",
    ownerName: "Ana",
    status: "replied",
    createdAt: created,
    connections: [],
  });
});

// C: several connections per person. Neither the old nor the new query has an ORDER BY, so the order is
// unspecified: compare as a set, and do not "fix" this into a sorted/positional assertion.
test("all of a person's connections are displayed (compared as a set)", () => {
  const detail = assembleDuplicateDetail(
    rows({ connections: [conn(A, BD1, "Ana", "01 Jan 2020"), conn(B, BD1, "Ana", null), conn(A, BD2, "Beto", "02 Feb 2021"), conn(A, "x3", "Cleo", null)] }),
  );
  assert.ok(detail);
  const key = (c: { bdName: string; connectedOn: string | null }) => `${c.bdName}|${c.connectedOn}`;
  assert.deepEqual(detail.personA.connections.map(key).sort(), ["Ana|01 Jan 2020", "Beto|02 Feb 2021", "Cleo|null"]);
  assert.equal(detail.personB.connections.length, 1);
});

// D: `bd.name` is NOT NULL in the schema, so an empty name is defensive. The old `owner[0]?.name ?? null`
// kept it; an `|| null` rewrite would turn it into null.
test("an empty owner name survives (?? null, not || null)", () => {
  const detail = assembleDuplicateDetail(rows({ persons: [personRow(A, { ownerBdId: BD1 }), personRow(B)], owners: [{ id: BD1, name: "" }] }));
  assert.ok(detail);
  assert.equal(detail.personA.ownerName, "");
});

// E
test("personDisplayName joins first and last, and falls back when both are empty", () => {
  assert.equal(personDisplayName({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
  assert.equal(personDisplayName({ firstName: "Ada", lastName: null }), "Ada");
  assert.equal(personDisplayName({ firstName: null, lastName: "Lovelace" }), "Lovelace");
  assert.equal(personDisplayName({ firstName: null, lastName: null }), "(sin nombre)");
  assert.equal(personDisplayName({ firstName: "", lastName: "" }), "(sin nombre)");
});
