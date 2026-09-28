/**
 * Unit tests for src/lib/accounts/accountTypeBackfill.ts — pure
 * parsing/merge/write planner behind
 * scripts/backfill-company-account-type.ts. Synthetic fixtures only, never
 * the real backups/ CSVs (real contact names/emails).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_TYPE_OVERRIDES,
  applyAccountTypeOverrides,
  extractEmails,
  findCrossNameEmailDomainOverlaps,
  mapAccountCsvRow,
  mergeAccountRows,
  parseAirtableCreatedDate,
  planAccountTypeWrites,
  type AccountTypeOverride,
  type ExistingAccountCompanyRef,
  type MergedAccount,
  type RawAccountRow,
} from "@/lib/accounts/accountTypeBackfill";

test("mapAccountCsvRow trims cells and reads only the fields this backfill writes", () => {
  const row = mapAccountCsvRow(
    {
      Cuenta: " Acme Corp ",
      Assignee: "Someone",
      Status: "In progress",
      "Categoría": " Partner ",
      Notes: " Some notes ",
      Created: " 23/5/2024 ",
      "Estado 2": "Sin proceso activo",
      "Contratos & Documentos": "",
    },
    "grid",
  );
  assert.deepEqual(row, {
    source: "grid",
    account: "Acme Corp",
    category: "Partner",
    notes: "Some notes",
    created: "23/5/2024",
  });
});

test("parseAirtableCreatedDate parses d/m/yyyy without leading zeros and rejects garbage", () => {
  const date = parseAirtableCreatedDate("23/5/2024");
  assert.equal(date?.getFullYear(), 2024);
  assert.equal(date?.getMonth(), 4);
  assert.equal(date?.getDate(), 23);
  assert.equal(parseAirtableCreatedDate("not a date"), null);
  assert.equal(parseAirtableCreatedDate(""), null);
});

function row(overrides: Partial<RawAccountRow>): RawAccountRow {
  return { source: "grid", account: "Acme Corp", category: "Partner", notes: "", created: "23/5/2024", ...overrides };
}

test("mergeAccountRows folds a known alias into the canonical name and merges notes", () => {
  const rows: RawAccountRow[] = [
    row({ source: "grid", account: "Winclamp", category: "Partner", notes: "Heredado. contact@winclap.com" }),
    row({ source: "pablo", account: "Winclap", category: "Partner", notes: "Heredado. contact@winclap.com" }),
  ];
  // No owner overrides here — this test is isolating alias-fold behavior,
  // not the real ACCOUNT_TYPE_OVERRIDES map (which requires "Dynamic
  // Tours" to be present in the input, tested separately below).
  const { accounts, conflicts } = mergeAccountRows(rows, {});
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]!.displayName, "Winclap");
  assert.equal(accounts[0]!.notes, "Heredado. contact@winclap.com");
  assert.equal(conflicts.length, 0);
});

test("mergeAccountRows resolves a Categoría conflict using the latest Created date and reports it (no override in play)", () => {
  const rows: RawAccountRow[] = [
    row({ source: "grid", account: "Some Other Account", category: "Org. estratégica", created: "23/5/2024" }),
    row({ source: "pablo", account: "Some Other Account", category: "Cliente", created: "16/11/2023" }),
  ];
  const { accounts, conflicts } = mergeAccountRows(rows, {});
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]!.accountType, "strategic_org");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.displayName, "Some Other Account");
  assert.equal(conflicts[0]!.resolvedCategory, "Org. estratégica");
});

test("mergeAccountRows applies the real ACCOUNT_TYPE_OVERRIDES entry for Dynamic Tours, winning over latest-date-wins, while still reporting the conflict", () => {
  const rows: RawAccountRow[] = [
    row({ source: "grid", account: "Dynamic Tours", category: "Org. estratégica", created: "23/5/2024" }),
    row({ source: "pablo", account: "Dynamic Tours", category: "Cliente", created: "16/11/2023" }),
  ];
  const { accounts, conflicts, appliedOverrides } = mergeAccountRows(rows);
  assert.equal(accounts.length, 1);
  // Latest-date-wins alone would have picked "Org. estratégica" — the
  // owner override replaces it with "partner".
  assert.equal(accounts[0]!.accountType, "partner");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.displayName, "Dynamic Tours");
  assert.equal(conflicts[0]!.resolvedCategory, "Org. estratégica");
  assert.equal(appliedOverrides.length, 1);
  assert.equal(appliedOverrides[0]!.displayName, "Dynamic Tours");
  assert.equal(appliedOverrides[0]!.previousAccountType, "strategic_org");
  assert.equal(appliedOverrides[0]!.accountType, "partner");
  assert.match(appliedOverrides[0]!.reason, /owner adjudicated/i);
});

test("applyAccountTypeOverrides throws when an override names an account absent from the input", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "acme", displayName: "Acme" })];
  const overrides: Readonly<Record<string, AccountTypeOverride>> = {
    "Some Typo Name": { accountType: "partner", reason: "owner adjudicated on 2026-09-28" },
  };
  assert.throws(() => applyAccountTypeOverrides(accounts, overrides), /Some Typo Name/);
});

test("applyAccountTypeOverrides does not mutate its input and is safe to call twice with the same result", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "acme", displayName: "Acme", accountType: "client" })];
  const overrides: Readonly<Record<string, AccountTypeOverride>> = {
    Acme: { accountType: "partner", reason: "owner adjudicated on 2026-09-28" },
  };
  const snapshot = JSON.parse(JSON.stringify(accounts));
  const first = applyAccountTypeOverrides(accounts, overrides);
  const second = applyAccountTypeOverrides(accounts, overrides);
  assert.deepEqual(accounts, snapshot);
  assert.deepEqual(first, second);
  assert.equal(first.accounts[0]!.accountType, "partner");
});

test("ACCOUNT_TYPE_OVERRIDES declares Dynamic Tours as a human-adjudicated partner, not a rule result", () => {
  const override = ACCOUNT_TYPE_OVERRIDES["Dynamic Tours"];
  assert.ok(override);
  assert.equal(override!.accountType, "partner");
  assert.match(override!.reason, /owner adjudicated/i);
  assert.match(override!.reason, /2026-09-28/);
});

test("mergeAccountRows maps every Categoría to its account type and dedupes identical notes across rows", () => {
  const rows: RawAccountRow[] = [
    row({ account: "A", category: "Partner", notes: "same text" }),
    row({ account: "A", source: "pablo", category: "Partner", notes: "same text" }),
    row({ account: "B", category: "Cliente", notes: "" }),
    row({ account: "C", category: "Org. estratégica", notes: "" }),
  ];
  const { accounts } = mergeAccountRows(rows, {});
  const byName = new Map(accounts.map((a) => [a.displayName, a]));
  assert.equal(byName.get("A")!.notes, "same text");
  assert.equal(byName.get("B")!.accountType, "client");
  assert.equal(byName.get("C")!.accountType, "strategic_org");
});

test("mergeAccountRows does not mutate its input and is safe to call twice with the same result", () => {
  const rows: RawAccountRow[] = [row({ account: "A" }), row({ account: "B", category: "Cliente" })];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const first = mergeAccountRows(rows, {});
  const second = mergeAccountRows(rows, {});
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(first, second);
});

test("extractEmails lowercases and dedupes emails found in free text", () => {
  const emails = extractEmails("Contact Foo@Bar.com or foo@bar.com, also baz@qux.io");
  assert.deepEqual(emails, ["foo@bar.com", "baz@qux.io"]);
});

function merged(overrides: Partial<MergedAccount>): MergedAccount {
  return { companyKey: "acme", displayName: "Acme", accountType: "partner", notes: null, ...overrides };
}

test("findCrossNameEmailDomainOverlaps flags two different account names sharing a note's email domain", () => {
  const accounts: MergedAccount[] = [
    merged({ companyKey: "winclamp", displayName: "Winclamp", notes: "contact@winclap.com" }),
    merged({ companyKey: "winclap", displayName: "Winclap", notes: "other@winclap.com" }),
    merged({ companyKey: "acme", displayName: "Acme", notes: "person@acme.com" }),
  ];
  const overlaps = findCrossNameEmailDomainOverlaps(accounts);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0]!.domain, "winclap.com");
  assert.deepEqual(overlaps[0]!.displayNames, ["Winclamp", "Winclap"]);
});

test("findCrossNameEmailDomainOverlaps finds nothing when every account's notes use distinct domains", () => {
  const accounts: MergedAccount[] = [
    merged({ companyKey: "acme", displayName: "Acme", notes: "a@acme.com" }),
    merged({ companyKey: "beta", displayName: "Beta", notes: "b@beta.com" }),
  ];
  assert.deepEqual(findCrossNameEmailDomainOverlaps(accounts), []);
});

function existingRef(overrides: Partial<ExistingAccountCompanyRef> = {}): ExistingAccountCompanyRef {
  return { companyKey: "acme", notes: null, ...overrides };
}

test("planAccountTypeWrites creates a company that has no existing row", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "new-co", displayName: "New Co", notes: "hi" })];
  const plan = planAccountTypeWrites(accounts, new Map());
  assert.equal(plan.companiesToCreate.length, 1);
  assert.equal(plan.companiesToCreate[0]!.companyKey, "new-co");
  assert.equal(plan.existingAccountTypeUpdates.length, 0);
});

test("planAccountTypeWrites sets account_type on an existing company and fills empty notes", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "acme", notes: "csv notes" })];
  const existing = new Map([["acme", existingRef({ notes: null })]]);
  const plan = planAccountTypeWrites(accounts, existing);
  assert.equal(plan.companiesToCreate.length, 0);
  assert.deepEqual(plan.existingAccountTypeUpdates, [{ companyKey: "acme", accountType: "partner" }]);
  assert.deepEqual(plan.existingNotesFills, [{ companyKey: "acme", notes: "csv notes" }]);
  assert.equal(plan.existingNotesSkipped.length, 0);
});

test("planAccountTypeWrites never overwrites a non-empty existing notes value", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "acme", notes: "csv notes" })];
  const existing = new Map([["acme", existingRef({ notes: "already has notes" })]]);
  const plan = planAccountTypeWrites(accounts, existing);
  assert.equal(plan.existingNotesFills.length, 0);
  assert.deepEqual(plan.existingNotesSkipped, [{ companyKey: "acme" }]);
  // account_type is still set even when notes are skipped.
  assert.deepEqual(plan.existingAccountTypeUpdates, [{ companyKey: "acme", accountType: "partner" }]);
});

test("planAccountTypeWrites does not mutate its inputs and is safe to call twice with the same result", () => {
  const accounts: MergedAccount[] = [merged({ companyKey: "acme", notes: "csv notes" })];
  const existing = new Map([["acme", existingRef({ notes: null })]]);
  const accountsSnapshot = JSON.parse(JSON.stringify(accounts));
  const existingSnapshot = new Map(existing);
  const first = planAccountTypeWrites(accounts, existing);
  const second = planAccountTypeWrites(accounts, existing);
  assert.deepEqual(accounts, accountsSnapshot);
  assert.deepEqual(existing, existingSnapshot);
  assert.deepEqual(first, second);
});
