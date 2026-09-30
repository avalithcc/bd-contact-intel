/**
 * Guards the privacy rule behind Registro de auditoría (admin-conversation-
 * access mockup, screen 3; owner decision 2026-09-30: the audit trail is
 * visible ONLY to administrators, no BD-facing surface at all).
 *
 * Two static checks over `src/`:
 *  1. Only one file ever SELECTs from the `audit_log` table:
 *     src/lib/activity/auditLogQueries.ts (getConversationForAdmin.ts only
 *     INSERTs into it, writing the audit trail — never reads it back).
 *  2. Every importer of `listConversationAuditLog` (that file's own read)
 *     lives under `src/app/(app)/admin/` — the same 404-for-non-admins
 *     route family every other admin-only screen uses (requireAdmin()).
 *
 * A BD-facing page could otherwise import the query directly without going
 * through any admin guard; this scan catches that at the import graph level
 * instead of trusting every future call site to remember the rule by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

const SRC = "src";
const QUERY_FILE = join("src", "lib", "activity", "auditLogQueries.ts");
const ADMIN_DIR_MARKER = `${sep}app${sep}(app)${sep}admin${sep}`;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function listSrcFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(SRC, f));
}

test("only auditLogQueries.ts ever SELECTs view_conversation rows from audit_log", () => {
  const offenders: string[] = [];
  for (const file of listSrcFiles()) {
    if (file === QUERY_FILE) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    // `audit_log` legitimately serves OTHER actions too (merge/unmerge,
    // migration approvals, the identity-backfill revert scripts under
    // src/lib/identity/) — this scan only cares about reads scoped to
    // `view_conversation`, the conversation-view trail, not every read of
    // the shared table. A raw `.select(...)...from(auditLog)` read —
    // INSERTs (getConversationForAdmin.ts's audit write) don't match this
    // shape at all.
    if (/\.from\(\s*auditLog\s*\)/.test(src) && /view_conversation/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `view_conversation audit_log read outside auditLogQueries.ts:\n${offenders.join("\n")}`);
});

test("every importer of listConversationAuditLog is an admin-only route", () => {
  const offenders: string[] = [];
  for (const file of listSrcFiles()) {
    if (file === QUERY_FILE) continue;
    const src = readFileSync(file, "utf8");
    if (!/listConversationAuditLog/.test(src)) continue;
    if (!file.includes(ADMIN_DIR_MARKER)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `non-admin importer of listConversationAuditLog:\n${offenders.join("\n")}`);
});

test("sanity: the query file itself does read from audit_log (guards against a silently broken regex)", () => {
  const src = readFileSync(QUERY_FILE, "utf8");
  assert.ok(/\.from\(\s*auditLog\s*\)/.test(src), "expected auditLogQueries.ts to select from auditLog");
});
