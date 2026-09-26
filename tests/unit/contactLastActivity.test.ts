/**
 * Unit tests for src/lib/contacts/lastActivity.ts — the "Última actividad"
 * column (mockups/contacts.html: "Correo enviado · hace 2d", "Descartado ·
 * hace 2sem", "—" when none). Pure label derivation only — no DB — reuses
 * the same activity-type taxonomy the record page's Timeline renders
 * (src/lib/activity/queries.ts TIMELINE_ACTIVITY_TYPES), not a new one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLastActivityEntries, formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { t } from "@/lib/i18n/dictionaries";

const dict = t("es");

test("formatLastActivityLabel: email_sent -> 'Correo enviado'", () => {
  assert.equal(formatLastActivityLabel({ type: "email_sent", metadata: {} }, dict), dict.contactList.lastActivityEmailSent);
});

test("formatLastActivityLabel: meeting_logged -> 'Reunión registrada'", () => {
  assert.equal(
    formatLastActivityLabel({ type: "meeting_logged", metadata: {} }, dict),
    dict.contactList.lastActivityMeetingLogged,
  );
});

test("formatLastActivityLabel: discarded -> 'Descartado'", () => {
  assert.equal(formatLastActivityLabel({ type: "discarded", metadata: {} }, dict), dict.contactList.lastActivityDiscarded);
});

test("formatLastActivityLabel: status_change to 'replied' -> 'Respuesta recibida'", () => {
  assert.equal(
    formatLastActivityLabel({ type: "status_change", metadata: { status: "replied" } }, dict),
    dict.contactList.lastActivityReplyReceived,
  );
});

test("formatLastActivityLabel: status_change to any other known status falls back to that status's own label", () => {
  assert.equal(
    formatLastActivityLabel({ type: "status_change", metadata: { status: "contacted" } }, dict),
    dict.leadStatuses.contacted,
  );
});

test("formatLastActivityLabel: status_backfill follows the same rule as status_change", () => {
  assert.equal(
    formatLastActivityLabel({ type: "status_backfill", metadata: { status: "replied" } }, dict),
    dict.contactList.lastActivityReplyReceived,
  );
});

test("formatLastActivityLabel: note/hunter_lookup get their own labels", () => {
  assert.equal(formatLastActivityLabel({ type: "note", metadata: {} }, dict), dict.contactList.lastActivityNote);
  assert.equal(
    formatLastActivityLabel({ type: "hunter_lookup", metadata: {} }, dict),
    dict.contactList.lastActivityHunterLookup,
  );
});

test("formatLastActivityLabel: malformed/non-object metadata never throws, falls back to the generic label", () => {
  assert.equal(
    formatLastActivityLabel({ type: "status_change", metadata: "not-an-object" }, dict),
    dict.contactList.lastActivityStatusChanged,
  );
});

test("buildLastActivityEntries maps rows to a personId -> {type, label, createdAt} map", () => {
  const at = new Date("2026-09-20T10:00:00Z");
  const map = buildLastActivityEntries(
    [{ personId: "p1", type: "email_sent", metadata: {}, createdAt: at }],
    dict,
  );
  assert.deepEqual(map.get("p1"), { type: "email_sent", label: dict.contactList.lastActivityEmailSent, createdAt: at });
  assert.equal(map.get("missing"), undefined);
});
