/**
 * Who sees which meetings on /reuniones, the default tab and the tab links (meeting-outcomes). Pure rules; the SQL that applies
 * the scope is in src/lib/meetings/queries.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMeetingView, meetingViewTabs, resolveMeetingScope, type MeetingViewCounts } from "@/lib/meetings/view";

const NOW = new Date("2026-10-22T21:00:00.000Z"); // 18:00 ART, 22 Oct 2026
const BD = { id: "bd-1", role: "bd" };
const ADMIN = { id: "admin-1", role: "admin" };
const OTHER = "11111111-1111-4111-8111-111111111111";

test("a BD sees only their own meetings, with no BD or date filter whatever the URL says", () => {
  const scope = resolveMeetingScope(BD, { bd: OTHER, from: "2026-01-01", to: "2026-01-31" }, NOW);
  assert.deepEqual(scope, { isAdmin: false, bdId: "bd-1", from: null, toExclusive: null, fromDate: null, toDate: null });
});

test("an admin sees every BD, in the current Argentina month by default", () => {
  const scope = resolveMeetingScope(ADMIN, {}, NOW);
  assert.equal(scope.isAdmin, true);
  assert.equal(scope.bdId, null);
  assert.equal(scope.fromDate, "2026-10-01");
  assert.equal(scope.toDate, "2026-10-31");
  assert.equal(scope.from?.toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(scope.toExclusive?.toISOString(), "2026-11-01T03:00:00.000Z");
});

test("the month default follows the Argentina calendar at the boundary", () => {
  // 00:30 UTC on 1 Nov is still 21:30 on 31 Oct in Argentina.
  assert.equal(resolveMeetingScope(ADMIN, {}, new Date("2026-11-01T00:30:00.000Z")).fromDate, "2026-10-01");
});

test("an admin can filter by BD and by date range; a malformed value falls back to the default", () => {
  const scope = resolveMeetingScope(ADMIN, { bd: OTHER, from: "2026-10-05", to: "2026-10-10" }, NOW);
  assert.equal(scope.bdId, OTHER);
  assert.equal(scope.fromDate, "2026-10-05");
  assert.equal(scope.toExclusive?.toISOString(), "2026-10-11T03:00:00.000Z");
  const bad = resolveMeetingScope(ADMIN, { bd: "not-a-uuid", from: "2026-02-31", to: "x" }, NOW);
  assert.equal(bad.bdId, null);
  assert.equal(bad.fromDate, "2026-10-01");
  assert.equal(bad.toDate, "2026-10-31");
});

test("a reversed range is swapped instead of silently returning nothing", () => {
  const scope = resolveMeetingScope(ADMIN, { from: "2026-10-20", to: "2026-10-10" }, NOW);
  assert.equal(scope.fromDate, "2026-10-10");
  assert.equal(scope.toDate, "2026-10-20");
});

const counts = (over: Partial<MeetingViewCounts> = {}): MeetingViewCounts => ({
  pending: 0,
  scheduled: 4,
  held: 12,
  no_show: 2,
  rescheduled: 1,
  cancelled: 1,
  ...over,
});

test("the default tab is Por confirmar when there is any, else Agendadas", () => {
  assert.equal(defaultMeetingView(counts({ pending: 3 })), "pending");
  assert.equal(defaultMeetingView(counts()), "scheduled");
});

const LABELS = { pending: "Por confirmar", scheduled: "Agendadas", held: "Realizadas", no_show: "No se presentó", rescheduled: "Reprogramadas", cancelled: "Canceladas" };

test("six tabs in mockup order, each with its count, link and the active flag", () => {
  const tabs = meetingViewTabs(counts({ pending: 3 }), "held", LABELS, {});
  assert.deepEqual(
    tabs.map((t) => [t.key, t.label, t.count, t.active]),
    [
      ["pending", "Por confirmar", 3, false],
      ["scheduled", "Agendadas", 4, false],
      ["held", "Realizadas", 12, true],
      ["no_show", "No se presentó", 2, false],
      ["rescheduled", "Reprogramadas", 1, false],
      ["cancelled", "Canceladas", 1, false],
    ],
  );
  assert.equal(tabs[0]!.href, "/reuniones?view=pending");
});

test("the admin's filters ride along on every tab link", () => {
  const tabs = meetingViewTabs(counts(), "held", LABELS, { bd: OTHER, from: "2026-10-01", to: "2026-10-31" });
  assert.equal(tabs[2]!.href, `/reuniones?view=held&bd=${OTHER}&from=2026-10-01&to=2026-10-31`);
});
