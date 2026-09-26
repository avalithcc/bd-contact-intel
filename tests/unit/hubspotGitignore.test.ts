/**
 * Guards the PII rule (design D8, spec "Export files never committed or
 * uploaded"): the local `hubspot/` export directory must stay excluded from
 * git. If this test ever fails, someone removed the `.gitignore` entry that
 * keeps the real HubSpot exports out of the repository.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test(".gitignore still excludes hubspot/", () => {
  const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
  const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
  assert.equal(lines.includes("/hubspot/"), true);
});
