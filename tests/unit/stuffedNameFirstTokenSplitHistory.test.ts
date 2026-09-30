/**
 * Unit tests for src/lib/identity/stuffedNameFirstTokenSplitHistory.ts. Pure,
 * no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFirstTokenSplitCompanyLinkHistoryRows,
  buildFirstTokenSplitNameHistoryRows,
} from "@/lib/identity/stuffedNameFirstTokenSplitHistory";

test("buildFirstTokenSplitNameHistoryRows writes one row per CHANGED field only", () => {
  const rows = buildFirstTokenSplitNameHistoryRows({
    personId: "p1",
    originalFirstName: "Julián Zamudio Lemos",
    originalLastName: null,
    firstName: "Julián",
    lastName: "Zamudio Lemos",
  });
  assert.deepEqual(rows, [
    { personId: "p1", property: "firstName", oldValue: "Julián Zamudio Lemos", newValue: "Julián", changedByBdId: null, source: "migration" },
    { personId: "p1", property: "lastName", oldValue: null, newValue: "Zamudio Lemos", changedByBdId: null, source: "migration" },
  ]);
});

test("buildFirstTokenSplitNameHistoryRows skips a field that did NOT change (Smart Gen override: only first_name changes)", () => {
  const rows = buildFirstTokenSplitNameHistoryRows({
    personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
    originalFirstName: "Smart Gen",
    originalLastName: null,
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(rows, [
    {
      personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
      property: "firstName",
      oldValue: "Smart Gen",
      newValue: null,
      changedByBdId: null,
      source: "migration",
    },
  ]);
});

test("buildFirstTokenSplitNameHistoryRows returns no rows when nothing changed at all", () => {
  const rows = buildFirstTokenSplitNameHistoryRows({
    personId: "p1",
    originalFirstName: "Same",
    originalLastName: "Same2",
    firstName: "Same",
    lastName: "Same2",
  });
  assert.deepEqual(rows, []);
});

test("buildFirstTokenSplitCompanyLinkHistoryRows writes company + companyKey rows, both from null", () => {
  const rows = buildFirstTokenSplitCompanyLinkHistoryRows({
    personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
    displayName: "Smart Gen",
    companyKey: "smart gen",
  });
  assert.deepEqual(rows, [
    { personId: "add5bf2d-6671-4a87-8254-bb3953699afb", property: "company", oldValue: null, newValue: "Smart Gen", changedByBdId: null, source: "migration" },
    { personId: "add5bf2d-6671-4a87-8254-bb3953699afb", property: "companyKey", oldValue: null, newValue: "smart gen", changedByBdId: null, source: "migration" },
  ]);
});
