/**
 * Unit tests for src/lib/migration/cliArgs.ts — scripts/unify-contacts.ts's
 * flag parser (design.md "Migration plan"; task: "CLI flags strict"). Pure,
 * no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "@/lib/migration/cliArgs";

test("parses --phase=collapse with no other flags as a dry run", () => {
  assert.deepEqual(parseArgs(["--phase=collapse"]), {
    phase: "collapse",
    mode: "dry_run",
    runId: null,
    file: null,
    companies: null,
  });
});

test("parses explicit --dry-run the same as the default", () => {
  assert.deepEqual(parseArgs(["--phase=fold_leads", "--dry-run"]), {
    phase: "fold_leads",
    mode: "dry_run",
    runId: null,
    file: null,
    companies: null,
  });
});

test("parses --execute with --run=<id>", () => {
  assert.deepEqual(parseArgs(["--phase=catch_up", "--execute", "--run=abc-123"]), {
    phase: "catch_up",
    mode: "execute",
    runId: "abc-123",
    file: null,
    companies: null,
  });
});

test("rejects a missing --phase", () => {
  assert.throws(() => parseArgs(["--execute"]), /--phase/);
});

test("rejects an invalid --phase value", () => {
  assert.throws(() => parseArgs(["--phase=bogus"]), /--phase/);
});

test("rejects --execute together with --dry-run", () => {
  assert.throws(
    () => parseArgs(["--phase=collapse", "--execute", "--dry-run"]),
    /--execute.*--dry-run|--dry-run.*--execute/,
  );
});

test("parses --phase=hubspot_import with --file and --companies as a dry run", () => {
  assert.deepEqual(parseArgs(["--phase=hubspot_import", "--file=/tmp/contacts.csv", "--companies=/tmp/companies.csv"]), {
    phase: "hubspot_import",
    mode: "dry_run",
    runId: null,
    file: "/tmp/contacts.csv",
    companies: "/tmp/companies.csv",
  });
});

test("rejects --phase=hubspot_import missing --file or --companies", () => {
  assert.throws(() => parseArgs(["--phase=hubspot_import", "--file=/tmp/contacts.csv"]), /--file.*--companies|--companies.*--file/);
  assert.throws(() => parseArgs(["--phase=hubspot_import", "--companies=/tmp/companies.csv"]), /--file.*--companies|--companies.*--file/);
  assert.throws(() => parseArgs(["--phase=hubspot_import"]), /--file.*--companies|--companies.*--file/);
});

test("rejects --file/--companies for any phase other than hubspot_import", () => {
  assert.throws(() => parseArgs(["--phase=collapse", "--file=/tmp/x.csv"]), /hubspot_import/);
  assert.throws(() => parseArgs(["--phase=catch_up", "--companies=/tmp/x.csv"]), /hubspot_import/);
});

test("rejects an unknown flag and lists the valid ones", () => {
  assert.throws(() => parseArgs(["--phase=collapse", "--wat"]), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /--wat/);
    assert.match(err.message, /--phase/);
    assert.match(err.message, /--execute/);
    assert.match(err.message, /--dry-run/);
    assert.match(err.message, /--run/);
    return true;
  });
});
