import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { test } from "node:test";
import { isPillSelectionComplete, resolveScopeEntries } from "@/lib/activity/timelinePills";
import { isCompanyFilterSelectionComplete, resolveCompanyScopeRows } from "@/lib/companies/recordMappers";
import { mostRecentActivity, timelineEntryCandidates } from "@/lib/contacts/recentActivity";
import { resolveWorkedTodayAt } from "@/lib/followUp/queueSelection";

const tomb = { at: new Date(), byBdId: null, byName: null };
const live = (i: number) => ({ id: `l${i}`, type: "note", scope: "company" as const, deleted: null });
const dead = (i: number) => ({ id: `d${i}`, type: "note", scope: "company" as const, deleted: tomb });

// A capped pool: 3 live notes + 2 tombstones, while the true (live-only) count is 5.
test("contact side: tombstones in a capped pool never make the pill look complete", () => {
  const pool = [live(1), live(2), live(3), dead(1), dead(2)];
  assert.equal(isPillSelectionComplete(pool, { note: 5 }, "note"), false);
  assert.equal(isPillSelectionComplete(pool, { note: 5 }, undefined), false);
  assert.deepEqual(resolveScopeEntries(pool, { note: 5 }, "note"), { kind: "fetch" });
  assert.equal(isPillSelectionComplete(pool, { note: 3 }, "note"), true, "all live rows in hand is still complete");
  assert.equal(resolveScopeEntries(pool, { note: 3 }, "note").kind, "ready");
});

test("company side: tombstones in a capped pool never make the filter look complete", () => {
  const contactLive = (i: number) => ({ id: `c${i}`, type: "note", scope: "contact" as const, deleted: null });
  const contactDead = (i: number) => ({ id: `cd${i}`, type: "note", scope: "contact" as const, deleted: tomb });
  const pool = [contactLive(1), contactLive(2), contactLive(3), contactDead(1), contactDead(2)];
  const counts = { all: 5, note: 0, stage_change: 0, contact_activity: 5 };
  assert.equal(isCompanyFilterSelectionComplete(pool, counts, "contact_activity"), false);
  assert.equal(isCompanyFilterSelectionComplete(pool, counts, "all"), false);
  assert.deepEqual(resolveCompanyScopeRows(pool, counts, "contact_activity"), { kind: "fetch" });
  assert.equal(isCompanyFilterSelectionComplete(pool, { ...counts, all: 3, contact_activity: 3 }, "contact_activity"), true);
});

test("Resumen's last activity ignores a tombstone: a contact whose only activity is a deleted note has none", () => {
  const labels = { channelEmail: "Email", channelNote: "Note", timelineSystemActor: "System" };
  const entry = (deleted: typeof tomb | null) => ({ type: "note", at: new Date("2026-10-15T11:20:00Z"), actorName: "Ana", deleted });
  assert.equal(mostRecentActivity(timelineEntryCandidates([entry(tomb)], labels)), null);
  assert.equal(mostRecentActivity(timelineEntryCandidates([entry(tomb), entry(null)], labels))?.channelLabel, "Note");
});

test("the admin flag comes from the deleter's role, not from comparing ids (imported note, removed BD)", async () => {
  const { buildTimelineEntry } = await import("@/lib/activity/timelineEntry");
  const base = { id: "n", type: "note", createdAt: new Date(), actorBdId: null, actorName: null, metadata: { note: "x" }, deletedAt: new Date() };
  assert.equal(buildTimelineEntry({ ...base, deletedByBdId: "a", deletedByName: "A", deletedByRole: "admin" }, "v").deleted?.byIsAdmin, true, "admin deleting an imported note (no author id)");
  assert.equal(buildTimelineEntry({ ...base, actorBdId: "x", deletedByBdId: null, deletedByName: null, deletedByRole: null }, "v").deleted?.byIsAdmin, false, "deleter removed since: not shown as admin");
  assert.equal(buildTimelineEntry({ ...base, actorBdId: "x", deletedByBdId: "x", deletedByName: "X", deletedByRole: "bd" }, "v").deleted?.byIsAdmin, false);
});

test("two questions, one rule: the display time hides a deleted note, the work time and every worked-today twin keep it", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { effectiveActivityAtSql, workDoneAtSql } = await import("@/lib/contacts/effectiveActivityTime");
  const { workedTodayAtSql } = await import("@/lib/followUp/queueSelection");
  const { readFileSync } = await import("node:fs");
  const dialect = new PgDialect();
  const text = (q: SQL) => dialect.sqlToQuery(q);
  assert.match(text(effectiveActivityAtSql()).sql, /deleted_at/);
  const work = text(workDoneAtSql());
  assert.doesNotMatch(work.sql, /deleted_at/);
  // Identical apart from the one branch: same placeholders, same params.
  const shown = text(effectiveActivityAtSql());
  assert.deepEqual(work.params, shown.params);
  assert.equal(work.sql.replace(/\s+/g, " "), shown.sql.replace(/when "activity"."deleted_at" is not null then null /, "").replace(/\s+/g, " "));
  assert.doesNotMatch(text(workedTodayAtSql()).sql, /deleted_at/);
  for (const f of ["src/lib/reports/queries.ts", "src/lib/shell/appShellBadgeCountsQuery.ts"]) {
    const twin = /_AT_SQL_TEXT = `([^`]*)`/.exec(readFileSync(f, "utf8"))![1]!;
    assert.doesNotMatch(twin, /deleted_at/, f);
  }
  const row = { id: "n", type: "note", createdAt: new Date(), metadata: {} };
  assert.ok(resolveWorkedTodayAt(row) instanceof Date);
});
