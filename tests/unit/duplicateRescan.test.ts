/**
 * Unit tests for src/lib/identity/duplicateRescan.ts and the write path in
 * duplicateRescanRun.ts (stubbed database, no I/O). Run with:
 * npx tsx --test tests/unit/duplicateRescan.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNameCompanyKey } from "@/lib/identity/matcher";
import { duplicateCandidatePairKey } from "@/lib/identity/nameFromEmailBackfill";
import {
  clampRescanCap,
  findRescanPairs,
  parseRescanParams,
  planDuplicateRescan,
  RESCAN_MAX_CAP,
  rescanReportToParams,
  RESCAN_SKIP_REASONS,
  type RescanPerson,
} from "@/lib/identity/duplicateRescan";
import { executeDuplicateRescan } from "@/lib/identity/duplicateRescanRun";

let seq = 0;
function p(first: string, last: string, company: string | null, over: Partial<RescanPerson> = {}): RescanPerson {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    firstName: first,
    lastName: last,
    company,
    companyKey: null,
    email: null,
    ...over,
  };
}

const sumSkipped = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0);

test("a group of 3 yields each pair exactly once, in canonical order", () => {
  const trio = [p("Ana", "Diaz", "Acme"), p("Ana", "Diaz", "Acme"), p("Ana", "Diaz", "Acme")];
  const { pairs } = findRescanPairs(trio);
  assert.equal(pairs.length, 3);
  const keys = pairs.map((x) => duplicateCandidatePairKey(x.personAId, x.personBId));
  assert.equal(new Set(keys).size, pairs.length);
  for (const x of pairs) assert.ok(x.personAId < x.personBId, "pair must be sorted a < b");
});

test("uses the write-time key exactly: a looser company spelling does not collide", () => {
  const people = [p("Roberto", "Gorchs", "Andina Tech"), p("Roberto", "Gorchs", "Andina")];
  assert.notEqual(
    buildNameCompanyKey({ firstName: "Roberto", lastName: "Gorchs", company: "Andina Tech" }),
    buildNameCompanyKey({ firstName: "Roberto", lastName: "Gorchs", company: "Andina" }),
  );
  assert.equal(findRescanPairs(people).pairs.length, 0);
});

test("every emitted pair shares the matcher key of both of its people", () => {
  const people = [p("José", "García", "Acme"), p("Jose", "Garcia", "ACME"), p("Otra", "Persona", "Acme")];
  const { pairs } = findRescanPairs(people);
  const byId = new Map(people.map((x) => [x.id, x]));
  assert.ok(pairs.length > 0);
  for (const x of pairs) {
    assert.equal(buildNameCompanyKey(byId.get(x.personAId)!), x.matchKey);
    assert.equal(buildNameCompanyKey(byId.get(x.personBId)!), x.matchKey);
  }
});

test("own-company rows are skipped and counted, not proposed", () => {
  const people = [
    p("Staff", "Member", "Avalith"),
    p("Staff", "Member", "Avalith"),
    p("Ext", "Contact", "Acme", { email: "a@avalith.net" }),
    p("Ext", "Contact", "Acme", { email: "b@avalith.net" }),
    p("Real", "Dup", "Acme"),
    p("Real", "Dup", "Acme"),
  ];
  const found = findRescanPairs(people);
  const plan = planDuplicateRescan(found, [], 50);
  assert.equal(found.ownCompanyPersons, 4);
  assert.equal(plan.skipped.own_company, 2);
  assert.equal(plan.toCreate.length, 1);
  const ownIds = new Set(people.slice(0, 4).map((x) => x.id));
  for (const c of plan.toCreate) assert.ok(!ownIds.has(c.personAId) && !ownIds.has(c.personBId));
});

test("a pair already present as merged or not_duplicate is never re-created", () => {
  for (const status of ["merged", "not_duplicate", "open"]) {
    const people = [p("Ana", "Lopez", "Acme"), p("Ana", "Lopez", "Acme"), p("Bo", "Ruiz", "Zeta"), p("Bo", "Ruiz", "Zeta")];
    const found = findRescanPairs(people);
    const closed = found.pairs[0]!;
    const existing = [{ personAId: closed.personBId, personBId: closed.personAId, status }]; // reversed on purpose
    const plan = planDuplicateRescan(found, existing, 50);
    const closedKey = duplicateCandidatePairKey(closed.personAId, closed.personBId);
    assert.ok(!plan.toCreate.some((c) => duplicateCandidatePairKey(c.personAId, c.personBId) === closedKey), status);
    assert.equal(plan.skipped[`existing_${status}` as keyof typeof plan.skipped], 1, status);
  }
});

test("the arithmetic closes over a varied fixture: found = created + remaining + skipped", () => {
  const people = [
    ...Array.from({ length: 4 }, () => p("Many", "Copies", "Acme")),
    p("Old", "Merged", "Beta"),
    p("Old", "Merged", "Beta"),
    p("Not", "Same", "Gamma"),
    p("Not", "Same", "Gamma"),
    p("Own", "Staff", "Avalith"),
    p("Own", "Staff", "Avalith"),
    ...Array.from({ length: 3 }, () => p("Fresh", "Dup", "Delta")),
    p("Solo", "Person", "Eps"),
  ];
  const found = findRescanPairs(people);
  const pick = (name: string) => found.pairs.find((x) => x.matchKey.startsWith(name))!;
  const existing = [
    { personAId: pick("old merged").personAId, personBId: pick("old merged").personBId, status: "merged" },
    { personAId: pick("not same").personAId, personBId: pick("not same").personBId, status: "not_duplicate" },
  ];
  for (const cap of [1, 3, 5, 50]) {
    const plan = planDuplicateRescan(found, existing, cap);
    assert.equal(plan.found, found.pairs.length);
    assert.equal(plan.found, plan.toCreate.length + plan.remaining + sumSkipped(plan.skipped), `cap ${cap}`);
    assert.deepEqual(Object.keys(plan.skipped).sort(), [...RESCAN_SKIP_REASONS].sort());
  }
});

test("the cap truncates rather than refusing, and the remainder is exact", () => {
  const people = Array.from({ length: 6 }, () => p("Big", "Group", "Acme")); // 15 pairs
  const found = findRescanPairs(people);
  const plan = planDuplicateRescan(found, [], 4);
  assert.equal(plan.toCreate.length, 4);
  assert.equal(plan.capped, true);
  assert.equal(plan.remaining, found.pairs.length - 4);
  const under = planDuplicateRescan(found, [], 500);
  assert.equal(under.capped, false);
  assert.equal(under.remaining, 0);
  assert.equal(under.toCreate.length, found.pairs.length);
});

test("the cap is deterministic: the next run continues where this one stopped", () => {
  const found = findRescanPairs(Array.from({ length: 5 }, () => p("Big", "Group", "Acme")));
  const first = planDuplicateRescan(found, [], 3);
  const existing = first.toCreate.map((c) => ({ personAId: c.personAId, personBId: c.personBId, status: "open" }));
  const second = planDuplicateRescan(found, existing, 3);
  const firstKeys = new Set(first.toCreate.map((c) => duplicateCandidatePairKey(c.personAId, c.personBId)));
  for (const c of second.toCreate) assert.ok(!firstKeys.has(duplicateCandidatePairKey(c.personAId, c.personBId)));
  assert.equal(first.toCreate.length + second.toCreate.length + second.remaining, found.pairs.length);
});

test("the planners are pure: same input twice gives the same output and inputs are untouched", () => {
  const people = [p("Ana", "Diaz", "Acme"), p("Ana", "Diaz", "Acme"), p("Ana", "Diaz", "Avalith"), p("Ana", "Diaz", "Avalith")];
  const snapshot = JSON.stringify(people);
  const a = findRescanPairs(people);
  const b = findRescanPairs(people);
  assert.deepEqual(a, b);
  const existing = [{ personAId: a.pairs[0]!.personAId, personBId: a.pairs[0]!.personBId, status: "merged" }];
  const existingSnapshot = JSON.stringify(existing);
  const foundSnapshot = JSON.stringify(a);
  assert.deepEqual(planDuplicateRescan(a, existing, 1), planDuplicateRescan(a, existing, 1));
  assert.equal(JSON.stringify(people), snapshot);
  assert.equal(JSON.stringify(existing), existingSnapshot);
  assert.equal(JSON.stringify(a), foundSnapshot);
});

test("clampRescanCap: junk falls back, the maximum is enforced server-side", () => {
  assert.equal(clampRescanCap("abc"), 50);
  assert.equal(clampRescanCap(0), 50);
  assert.equal(clampRescanCap("7"), 7);
  assert.equal(clampRescanCap(10_000), RESCAN_MAX_CAP);
});

test("the report survives the URL round trip", () => {
  const found = findRescanPairs(Array.from({ length: 4 }, () => p("Big", "Group", "Acme")));
  const plan = planDuplicateRescan(found, [], 2);
  const parsed = parseRescanParams(Object.fromEntries(rescanReportToParams({ ...plan, dryRun: true, created: 0, planned: plan.toCreate.length })));
  assert.equal(parsed?.found, plan.found);
  assert.equal(parsed?.remaining, plan.remaining);
  assert.equal(parsed?.dryRun, true);
  assert.equal(parseRescanParams({}), null);
});

// --- write path (stubbed database) -------------------------------------------

function fakeDb(lost = 0) {
  const calls = { insert: 0, auditInsert: 0, transactions: 0, audit: [] as unknown[] };
  const tx = {
    insert(_table: unknown) {
      return {
        values(rows: unknown) {
          const list = Array.isArray(rows) ? rows : [rows];
          const looksLikeAudit = list.length === 1 && "action" in (list[0] as object);
          if (looksLikeAudit) {
            calls.auditInsert += 1;
            calls.audit.push(list[0]);
            return Promise.resolve([]);
          }
          calls.insert += 1;
          return { onConflictDoNothing: () => ({ returning: async () => list.slice(0, list.length - lost).map((_, i) => ({ id: String(i) })) }) };
        },
      };
    },
  };
  const database = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
      calls.transactions += 1;
      return fn(tx);
    },
  };
  return { database: database as never, calls };
}

test("a dry run writes nothing: no candidate rows and no audit row", async () => {
  const found = findRescanPairs([p("Ana", "Diaz", "Acme"), p("Ana", "Diaz", "Acme")]);
  const plan = planDuplicateRescan(found, [], 50);
  const { database, calls } = fakeDb();
  const result = await executeDuplicateRescan(database, plan, { dryRun: true, trigger: "manual", actorBdId: "x" });
  assert.equal(calls.transactions, 0);
  assert.equal(calls.insert, 0);
  assert.equal(calls.auditInsert, 0);
  assert.equal(result.created, 0);
  assert.equal(result.dryRun, true);
});

test("a real run writes the candidates and exactly one audit row, in one transaction, carrying trigger and actor", async () => {
  const found = findRescanPairs(Array.from({ length: 3 }, () => p("Ana", "Diaz", "Acme")));
  const plan = planDuplicateRescan(found, [], 50);
  const { database, calls } = fakeDb();
  const result = await executeDuplicateRescan(database, plan, { dryRun: false, trigger: "cron", actorBdId: "bd-1" });
  assert.equal(calls.transactions, 1);
  assert.equal(calls.insert, 1);
  assert.equal(calls.auditInsert, 1);
  assert.equal(result.created, plan.toCreate.length);
  const audit = calls.audit[0] as { actorBdId: string; metadata: Record<string, unknown> };
  assert.equal(audit.actorBdId, "bd-1");
  assert.equal(audit.metadata.trigger, "cron");
  assert.equal(audit.metadata.found, plan.found);
  assert.equal(audit.metadata.created, result.created);
  assert.equal(audit.metadata.remaining, plan.remaining);
});

test("nothing to create still records the run (so the panel shows it ran), without candidate inserts", async () => {
  const plan = planDuplicateRescan(findRescanPairs([p("Solo", "One", "Acme")]), [], 50);
  const { database, calls } = fakeDb();
  await executeDuplicateRescan(database, plan, { dryRun: false, trigger: "manual", actorBdId: "bd-1" });
  assert.equal(calls.insert, 0);
  assert.equal(calls.auditInsert, 1);
});

test("the cap picks the same pairs whatever order the persons arrive in", () => {
  const people = [
    ...Array.from({ length: 5 }, () => p("Big", "Group", "Acme")),
    ...Array.from({ length: 4 }, () => p("Other", "Group", "Beta")),
  ];
  const pick = (input: RescanPerson[]) =>
    planDuplicateRescan(findRescanPairs(input), [], 4).toCreate.map((c) => duplicateCandidatePairKey(c.personAId, c.personBId));
  const baseline = pick(people);
  const orderings = [
    [...people].reverse(),
    [...people.slice(4), ...people.slice(0, 4)],
    people.filter((_, i) => i % 2 === 0).concat(people.filter((_, i) => i % 2 === 1)),
    [...people].sort((a, b) => (a.id < b.id ? 1 : -1)),
  ];
  for (const order of orderings) assert.deepEqual(pick(order), baseline);
});

test("pairs lost to a concurrent writer are reported as skipped, so nothing disappears silently", async () => {
  const found = findRescanPairs(Array.from({ length: 4 }, () => p("Ana", "Diaz", "Acme"))); // 6 pairs
  const plan = planDuplicateRescan(found, [], 5);
  const { database } = fakeDb(2);
  const report = await executeDuplicateRescan(database, plan, { dryRun: false, trigger: "manual", actorBdId: "bd-1" });
  assert.equal(report.created, plan.toCreate.length - 2);
  assert.equal(report.found, report.created + report.remaining + sumSkipped(report.skipped));
});
