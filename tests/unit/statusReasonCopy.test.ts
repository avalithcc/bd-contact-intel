/**
 * Unit tests for describeStatusReason (src/lib/contacts/labels.ts; mockup-
 * port r02; contact-record.html:77 "Estado" derivation "why" hint). Pure
 * string composition from a fixed Spanish server-strings slice (same shape
 * `dict.contactRecordServer` provides — this is deliberately NOT
 * `ContactRecordLabels`, which is `ClientStrings`-wrapped and forbids
 * function values; describeStatusReason is server-only).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStatusReason } from "@/lib/contacts/labels";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StatusReasonEvidence } from "@/lib/status/deriveStatus";

const serverStrings: Dictionary["contactRecordServer"] = {
  ownerHintOldestConnection: (date) => `Conexión más antigua (${date})`,
  hunterHint: (confidence, name, date) => `Hunter · ${confidence} % de confianza · actualizado por ${name}, ${date}`,
  statusReasonSourceEmail: "se envió un correo",
  statusReasonSourceMeeting: "se registró una reunión",
  statusReasonSourceCall: "se registró una llamada",
  statusReasonSourceStatusChange: "se registró un cambio de estado",
  statusReasonSourceDiscard: "se descartó el contacto",
  statusReasonSourceNote: "se agregó una nota",
  statusReasonSourceHunter: "se encontró un correo",
  statusReasonSourceConnectionReplied: (bdName) => `se recibió una respuesta de LinkedIn en la conversación de ${bdName}`,
  statusReasonSourceConnectionSent: (bdName) => `se envió un mensaje de LinkedIn en la conversación de ${bdName}`,
  statusReasonSentence: (a, b, c) => `${a} porque ${b} el ${c}.`,
  timelineLockedOwnedBy: (bdName) => `Esta conversación pertenece a ${bdName}.`,
  adminAuditAlertBody: (bdName) => `Auditado (${bdName}).`,
  hiringBadge: (count) => `Contratando · ${count} puestos de IT`,
  companyContactCount: (count) => `${count} contactos en esta empresa`,
  conversationHistorySummary: (count, dateLabel) => `${count} mensajes · último ${dateLabel}`,
  lastActivityFoot: (channelLabel, actorName) => `${channelLabel} · ${actorName}`,
  touchpointsFoot: (linkedin, email, notes) => `${linkedin} LinkedIn · ${email} correos · ${notes} notas`,
  openTaskLine: (title, dateLabel, assignedToName) => `${title} · vence ${dateLabel} · ${assignedToName}`,
  hiringSignalText: (companyName, count) => `${companyName} tiene ${count} puestos de IT abiertos.`,
  hiringSignalNewLast7Days: (count) => ` Publicó ${count} nuevos puestos esta semana.`,
  mergeCardBody: (count) => `${count} registros combinados durante la migración.`,
};

const leadStatuses = {
  new: "Nuevo",
  contacted: "Contactado",
  replied: "Respondió",
  meeting: "Reunión",
  discarded: "Descartado",
} as unknown as Dictionary["leadStatuses"];

const emptyValue = "—";
const nextStepHint = "Registrar una reunión para pasar a Reunión.";

test("connection-sourced 'replied' includes the bdName and the next-step hint", () => {
  const evidence: StatusReasonEvidence = {
    status: "replied",
    because: { source: "connection", bdId: "bd-1" },
    at: new Date("2026-10-12T18:04:00Z"),
    bdName: "Juan Martínez",
    activityType: null,
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "12 oct");
  assert.equal(
    result,
    "Respondió porque se recibió una respuesta de LinkedIn en la conversación de Juan Martínez el 12 oct. Registrar una reunión para pasar a Reunión.",
  );
});

test("connection-sourced 'contacted' uses the 'sent' phrasing, no next-step hint", () => {
  const evidence: StatusReasonEvidence = {
    status: "contacted",
    because: { source: "connection", bdId: "bd-2" },
    at: new Date("2026-10-01T00:00:00Z"),
    bdName: "Ana Pereyra",
    activityType: null,
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "1 oct");
  assert.equal(
    result,
    "Contactado porque se envió un mensaje de LinkedIn en la conversación de Ana Pereyra el 1 oct.",
  );
});

test("activity-sourced 'meeting' uses the activity-type source phrase", () => {
  const evidence: StatusReasonEvidence = {
    status: "meeting",
    because: { source: "activity", activityId: "a1" },
    at: new Date("2026-10-21T11:00:00Z"),
    bdName: null,
    activityType: "meeting_logged",
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "21 oct");
  assert.equal(result, "Reunión porque se registró una reunión el 21 oct.");
});

test("activity-sourced 'contacted' from a call uses the call source phrase", () => {
  const evidence: StatusReasonEvidence = {
    status: "contacted",
    because: { source: "activity", activityId: "a1" },
    at: new Date("2026-10-15T10:20:00Z"),
    bdName: null,
    activityType: "call",
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "15 oct");
  assert.equal(result, "Contactado porque se registró una llamada el 15 oct.");
});

test("activity-sourced with an unmapped activity type falls back to the generic status-change phrase", () => {
  const evidence: StatusReasonEvidence = {
    status: "contacted",
    because: { source: "activity", activityId: "a1" },
    at: new Date("2026-10-01T00:00:00Z"),
    bdName: null,
    activityType: "some_future_type",
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "1 oct");
  assert.equal(result, "Contactado porque se registró un cambio de estado el 1 oct.");
});

test("connection-sourced reason with a missing bdName falls back to the empty-value placeholder", () => {
  const evidence: StatusReasonEvidence = {
    status: "replied",
    because: { source: "connection", bdId: "bd-1" },
    at: new Date("2026-10-12T18:04:00Z"),
    bdName: null,
    activityType: null,
  };
  const result = describeStatusReason(serverStrings, leadStatuses, emptyValue, nextStepHint, evidence, "12 oct");
  assert.equal(
    result,
    "Respondió porque se recibió una respuesta de LinkedIn en la conversación de — el 12 oct. Registrar una reunión para pasar a Reunión.",
  );
});
