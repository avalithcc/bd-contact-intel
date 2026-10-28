/**
 * The pure half of the `bd` footprint sweep: which references stop an account from being deleted.
 * `readBdFootprint` itself talks to information_schema and is not unit-tested (the convention of
 * src/lib/companyMerge/db.ts); this is the decision scripts/delete-unused-bd.ts refuses on.
 *
 * The rule is derived from each foreign key's own ON DELETE rule, so a new column cannot quietly become
 * deletable: only `set null` is harmless, because the referencing row survives with a null pointer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { blockingReferences, deleteRuleFromCode, isBlockingReference, type BdReference } from "@/lib/bd/bdFootprint";

const ref = (over: Partial<BdReference> = {}): BdReference => ({
  table: "person",
  column: "owner_bd_id",
  deleteRule: "NO ACTION",
  rows: 0,
  ...over,
});

test("no rows never blocks, whatever the delete rule says", () => {
  for (const deleteRule of ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT", "SET DEFAULT"]) {
    assert.equal(isBlockingReference(ref({ deleteRule, rows: 0 })), false, deleteRule);
  }
});

// This is the whole safety property: losing audit history to a cascade is exactly what must not happen
// silently, while a nulled pointer costs nothing.
test("with rows, only 'set null' is harmless; a cascade blocks because it would delete that history", () => {
  assert.equal(isBlockingReference(ref({ table: "audit_log", column: "target_bd_id", deleteRule: "SET NULL", rows: 2 })), false);
  assert.equal(isBlockingReference(ref({ table: "audit_log", column: "actor_bd_id", deleteRule: "CASCADE", rows: 1 })), true);
  assert.equal(isBlockingReference(ref({ table: "person", column: "owner_bd_id", deleteRule: "NO ACTION", rows: 1 })), true);
  assert.equal(isBlockingReference(ref({ table: "task", column: "assigned_to_bd_id", deleteRule: "RESTRICT", rows: 1 })), true);
  // An unknown rule is treated as blocking rather than guessed at.
  assert.equal(isBlockingReference(ref({ deleteRule: "SET DEFAULT", rows: 1 })), true);
});

test("the delete rule is matched case-insensitively, as information_schema casing is not guaranteed", () => {
  assert.equal(isBlockingReference(ref({ deleteRule: "set null", rows: 3 })), false);
  assert.equal(isBlockingReference(ref({ deleteRule: "Set Null", rows: 3 })), false);
});

test("blockingReferences keeps only the blocking ones, in order, and does not mutate its input", () => {
  const references = [
    ref({ table: "audit_log", column: "target_bd_id", deleteRule: "SET NULL", rows: 2 }),
    ref({ table: "person", column: "owner_bd_id", deleteRule: "NO ACTION", rows: 0 }),
    ref({ table: "activity", column: "actor_bd_id", deleteRule: "CASCADE", rows: 7 }),
    ref({ table: "task", column: "actor_bd_id", deleteRule: "CASCADE", rows: 0 }),
    ref({ table: "sequence", column: "owner_bd_id", deleteRule: "NO ACTION", rows: 1 }),
  ];
  const before = JSON.stringify(references);
  assert.deepEqual(
    blockingReferences(references).map((r) => `${r.table}.${r.column}`),
    ["activity.actor_bd_id", "sequence.owner_bd_id"],
  );
  assert.equal(JSON.stringify(references), before);
  assert.deepEqual(blockingReferences([]), []);
});

test("a sweep whose only non-empty column is set-null has nothing blocking", () => {
  const swept = [
    ref({ table: "audit_log", column: "target_bd_id", deleteRule: "SET NULL", rows: 2 }),
    ...["person.owner_bd_id", "task.actor_bd_id", "sequence.owner_bd_id", "email_account.bd_id"].map((name) => {
      const [table, column] = name.split(".");
      return ref({ table, column, deleteRule: "CASCADE", rows: 0 });
    }),
  ];
  assert.deepEqual(blockingReferences(swept), []);
});

/**
 * `deleteRuleFromCode` is the producer of every `deleteRule` the gate above reads, so a wrong mapping is the
 * one way a CASCADE column could be judged harmless. The codes are pg_constraint.confdeltype's.
 */
test("deleteRuleFromCode maps pg_constraint's codes, and an unknown code is not harmless", () => {
  assert.equal(deleteRuleFromCode("n"), "SET NULL");
  assert.equal(deleteRuleFromCode("c"), "CASCADE");
  assert.equal(deleteRuleFromCode("r"), "RESTRICT");
  assert.equal(deleteRuleFromCode("d"), "SET DEFAULT");
  assert.equal(deleteRuleFromCode("a"), "NO ACTION");
  // Only 'n' may ever produce the one rule the gate lets through.
  for (const code of ["c", "r", "d", "a", "x", "", "N"]) {
    assert.notEqual(deleteRuleFromCode(code).toUpperCase(), "SET NULL", code);
    assert.equal(isBlockingReference(ref({ deleteRule: deleteRuleFromCode(code), rows: 1 })), true, code);
  }
});
