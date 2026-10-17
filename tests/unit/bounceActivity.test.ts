/**
 * A bounce is its own activity type, `email_bounced`: status-neutral and no-progress by construction, shown under the
 * "Correos" pill, dated by the notification and private to the BD whose mail bounced. Metadata fixtures come from the real
 * producer (buildBounceMetadata over a planned event), never from hand-built objects.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";
import { TIMELINE_PILL_GROUPS } from "@/lib/activity/timelinePills";
import { bounceEntryText, emailBounceHint, latestHardBounce, maskAddress } from "@/lib/contacts/bounceView";
import { formatArgentinaDayMonth } from "@/lib/i18n/format";
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { entryBody } from "@/lib/contacts/timelineEntryBody";
import { buildBounceMetadata, planBounces, readBounceMetadata } from "@/lib/gmail/bouncePlan";
import { parseBounce } from "@/lib/gmail/parseBounce";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { t } from "@/lib/i18n/dictionaries";
import { OCCURRED_AT_ACTIVITY_TYPES, STATUS_NEUTRAL_ACTIVITY_TYPES } from "@/lib/status/deriveStatus";
import { ORIGINAL_ID, gmailDelay422, gmailHard511 } from "./bounceFixtures";

const outbound = [{ gmailThreadId: "thread-out-1", rfcMessageId: ORIGINAL_ID, recipients: ["lucia@acme-ejemplo.test"], subject: "Squads nearshore para Acme" }];
const event = (m: ReturnType<typeof gmailHard511>) => planBounces([parseBounce(m)!], outbound, new Set()).events[0]!;

const hardMeta = () => buildBounceMetadata(event(gmailHard511()), { sequenceNames: ["Outreach CTO Q4"], scheduledCancelled: 2, discarded: 1 });
const softMeta = () => buildBounceMetadata(event(gmailDelay422()), undefined);

test("the metadata a producer writes is read back by the consumers", () => {
  const read = readBounceMetadata(hardMeta());
  assert.equal(read?.severity, "hard");
  assert.equal(read?.statusCode, "5.1.1");
  assert.deepEqual(read?.sequenceNames, ["Outreach CTO Q4"]);
  assert.equal(read?.scheduledCancelled, 2);
  assert.equal(readBounceMetadata(softMeta())?.severity, "soft");
  assert.equal(readBounceMetadata({ severity: "weird" }), null);
  assert.equal(readBounceMetadata(null), null);
});

test("the type is registered everywhere a bounce must behave differently from a touch", () => {
  assert.ok((STATUS_NEUTRAL_ACTIVITY_TYPES as readonly string[]).includes("email_bounced"));
  assert.ok((NO_PROGRESS_ACTIVITY_TYPES as readonly string[]).includes("email_bounced"));
  assert.ok((OCCURRED_AT_ACTIVITY_TYPES as readonly string[]).includes("email_bounced"));
  // queries.ts imports the database client, so its list is read as source text.
  assert.match(readFileSync("src/lib/activity/queries.ts", "utf8"), /TIMELINE_ACTIVITY_TYPES = \[[^\]]*"email_bounced"/);
  assert.ok(TIMELINE_PILL_GROUPS.email_sent.includes("email_bounced"));
});

test("a bounce is dated by the notification, not by the sync", () => {
  const at = resolveEffectiveActivityAt({ id: "a", type: "email_bounced", createdAt: new Date("2026-10-20T00:00:00Z"), metadata: hardMeta(), deletedAt: null });
  assert.equal(at?.toISOString(), new Date(1792000000000).toISOString());
});

test("only the BD whose mail bounced (or an admin) sees the entry's content", () => {
  assert.equal(isTimelineEntryVisible({ type: "email_bounced", actorBdId: "bd-1" }, "bd-2"), false);
  assert.equal(isTimelineEntryVisible({ type: "email_bounced", actorBdId: "bd-1" }, "bd-1"), true);
  assert.equal(isTimelineEntryVisible({ type: "email_bounced", actorBdId: "bd-1" }, "bd-2", true), true);
});

const dict = t("es");
const labels = pickContactRecordLabels(dict);

test("the address is masked in the UI text and the reason is in Spanish", () => {
  assert.equal(maskAddress("lucia@acme-ejemplo.test"), "l***@acme-ejemplo.test");
  const hard = entryBody({ type: "email_bounced", visible: true, metadata: hardMeta(), actorName: null }, labels);
  assert.match(hard, /l\*\*\*@acme-ejemplo\.test/);
  assert.match(hard, /casilla inexistente \(5\.1\.1\)/);
  assert.doesNotMatch(hard, /lucia@/);
  const soft = entryBody({ type: "email_bounced", visible: true, metadata: softMeta(), actorName: null }, labels);
  assert.match(soft, /casilla llena \(4\.2\.2\)/);
});

test("bounceEntryText gives the headline of each severity", () => {
  assert.match(bounceEntryText(readBounceMetadata(hardMeta())!, labels).headline, /rebotó \(definitivo\)/);
  assert.match(bounceEntryText(readBounceMetadata(softMeta())!, labels).headline, /Entrega demorada/);
});

test("the contact list names the last activity", () => {
  assert.equal(formatLastActivityLabel({ type: "email_bounced", metadata: hardMeta() }, dict), "Correo rebotado");
});

test("the record's hint comes from the latest HARD entry, ignoring soft ones and other types", () => {
  const older = { ...hardMeta(), occurredAt: "2026-10-01T10:00:00.000Z", statusCode: "5.1.2", reasonKey: "domain_not_found" };
  const newer = { ...hardMeta(), occurredAt: "2026-10-14T12:41:00.000Z" };
  const laterSoft = { ...softMeta(), occurredAt: "2026-10-16T12:00:00.000Z" };
  const rows = [
    { type: "email_bounced", metadata: older },
    { type: "email_bounced", metadata: laterSoft },
    { type: "note", metadata: { note: "x" } },
    { type: "email_bounced", metadata: newer },
  ];
  const found = latestHardBounce(rows);
  assert.equal(found?.occurredAt.toISOString(), "2026-10-14T12:41:00.000Z");
  assert.equal(found?.statusCode, "5.1.1");
  assert.equal(latestHardBounce([{ type: "email_bounced", metadata: laterSoft }]), null);
  assert.equal(latestHardBounce([]), null);
});

test("the hint reads 'Rebotó el {fecha} · {motivo} ({código})'", () => {
  const found = latestHardBounce([{ type: "email_bounced", metadata: hardMeta() }])!;
  const hint = emailBounceHint(found, labels, (d) => formatArgentinaDayMonth(d));
  assert.match(hint, /^Rebotó el \d{1,2} \S+ · casilla inexistente \(5\.1\.1\)$/);
});
