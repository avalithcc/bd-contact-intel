/**
 * Unit tests for src/lib/contacts/outreachView.ts — the `/contacts`
 * "Outreach" system view adapter (owner decision 2026-09-26: SAME ranking
 * as today's `/outreach`, reusing the shared scoring module unmodified).
 * Pure mapping only — no DB — the ranking itself stays covered by
 * compareOutreachRows/relationshipTierOf/outreachReasons in
 * src/lib/outreach/ranking.ts, not duplicated here. Deliberately imports
 * nothing that touches `@/db` (see outreachView.ts's doc comment) so this
 * runs under plain `npm run test:unit`, no DATABASE_URL required.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachOutreachReasons } from "@/lib/contacts/outreachView";
import type { OutreachRow } from "@/lib/outreach/ranking";
import { resolveLastActivity } from "@/lib/contacts/lastActivity";
import { t } from "@/lib/i18n/dictionaries";

function row(overrides: Partial<OutreachRow> = {}): OutreachRow {
  return {
    id: "c1",
    hasOwnContact: true,
    personId: "p1",
    firstName: "Ada",
    lastName: "Lovelace",
    company: "Analytical Engines",
    position: "CTO",
    roleGroup: "eng_leadership",
    messageCount: 0,
    lastMessageAt: null,
    reciprocal: false,
    dormant: false,
    isLeadership: true,
    relationshipTier: "never_messaged",
    companyDisplayName: "Analytical Engines",
    openItCount: 3,
    offshoreItCount: 0,
    latamItCount: 0,
    offshoreHeavy: false,
    isStartup: null,
    startupReason: null,
    ...overrides,
  };
}

const dict = t("es");
const relTime = () => "hace 2 días";

test("attachOutreachReasons preserves row order and shape", () => {
  const rows = [row({ id: "a" }), row({ id: "b", relationshipTier: "dormant" })];
  const result = attachOutreachReasons(rows, relTime, dict);
  assert.deepEqual(result.map((r) => r.id), ["a", "b"]);
  assert.equal(result[0].firstName, "Ada");
});

test("attachOutreachReasons reuses outreachReasons — same wording as /outreach", () => {
  const [result] = attachOutreachReasons([row()], relTime, dict);
  assert.ok(result.reasons.includes(dict.outreach.reasonNeverMessaged));
  assert.ok(result.reasons.some((r) => r.includes("3")));
});

test("attachOutreachReasons is a pure superset of OutreachRow — no fields dropped", () => {
  const source = row({ isStartup: true, startupReason: "seed" });
  const [result] = attachOutreachReasons([source], relTime, dict);
  assert.equal(result.isStartup, true);
  assert.equal(result.startupReason, "seed");
});

test("attachOutreachReasons names the newest activity with the contacts-list label", () => {
  const at = "2026-09-20T10:00:00Z";
  const cases = [
    { type: "email_sent", label: dict.contactList.lastActivityEmailSent },
    { type: "reply_received", label: dict.contactList.lastActivityReplyReceived },
    { type: "auto_reply_received", label: dict.contactList.lastActivityAutoReply },
  ];
  for (const c of cases) {
    const [r] = attachOutreachReasons([row({ lastActivityRaw: { type: c.type, metadata: {}, createdAt: at } })], relTime, dict);
    assert.equal(r.lastActivity?.label, c.label, c.type);
  }
  assert.notEqual(dict.contactList.lastActivityAutoReply, dict.contactList.lastActivityReplyReceived);
});

test("attachOutreachReasons gives no lastActivity when there is none", () => {
  assert.equal(attachOutreachReasons([row()], relTime, dict)[0].lastActivity, null);
  const nonTouch = row({ lastActivityRaw: { type: "task_updated", metadata: {}, createdAt: null } });
  assert.equal(attachOutreachReasons([nonTouch], relTime, dict)[0].lastActivity, null);
});

test("a linkedin_message entry renders the unqualified LinkedIn label, never an 'enviado' variant", () => {
  const [r] = attachOutreachReasons(
    [row({ lastActivityRaw: { type: "linkedin_message", metadata: null, createdAt: "2026-09-20T10:00:00Z" } })],
    relTime,
    dict,
  );
  assert.equal(r.lastActivity?.label, "Mensaje de LinkedIn");
});

test("resolveLastActivity: LinkedIn date is the fallback, a real activity always wins, neither is null", () => {
  const li = new Date("2026-09-20T10:00:00Z");
  const act = { type: "email_sent", label: dict.contactList.lastActivityEmailSent, createdAt: new Date("2026-01-01T00:00:00Z") };
  const fallback = resolveLastActivity(null, li, dict);
  assert.equal(fallback?.label, dict.contactList.lastActivityLinkedin);
  assert.equal(fallback?.createdAt.toISOString(), li.toISOString());
  // Precedence holds even when the LinkedIn date is NEWER than the activity.
  assert.equal(resolveLastActivity(act, li, dict), act);
  assert.equal(resolveLastActivity(null, null, dict), null);
});
