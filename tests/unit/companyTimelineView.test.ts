/**
 * Unit tests for src/lib/companies/timelineView.ts — the SERVER-ONLY
 * "what"/"body" formatter for the Activity tab's rows (fix/company-
 * timeline-filter-no-reload). See that module's doc comment for why this
 * step can't run inside the "use client" CompanyTimeline.tsx.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyTimelineViewRows } from "@/lib/companies/timelineView";

const serverStrings = {
  noteBy: (actor: string) => `Nota · ${actor}`,
  emailSentTo: (to: string) => `Correo enviado a ${to}`,
  stageChanged: (from: string, to: string) => `Etapa cambiada de ${from} → ${to}`,
  assocViewAll: (n: number) => `Ver los ${n} en Contactos`,
  vacantesFooter: (total: number, latam: number, us: number) => `${total} · ${latam} · ${us}`,
};

const labels = {
  meetingLogged: "Reunión registrada",
  atNote: "Nota",
  atEmailSent: "Correo",
  atReplyReceived: "Respuesta recibida",
  atReplyReceivedDefault: "Respuesta recibida.",
  atStatusChange: "Cambio de etapa",
  atMeetingLogged: "Reunión",
  atCall: "Llamada",
  atDiscarded: "Descartado",
  atHunterLookup: "Búsqueda",
  atStatusBackfill: "Historial",
  atTaskUpdated: "Tarea editada",
  atTaskCompleted: "Tarea completada",
  atTaskReopened: "Tarea reabierta",
  taskChangeFieldTitle: "Título",
  taskChangeFieldDue: "Vencimiento",
  taskChangeFieldAssignee: "Asignada a",
  taskChangeFieldDescription: "Descripción",
  taskChangeUpdatedPrefix: "editó la tarea",
  taskChangeCompletedPrefix: "completó la tarea",
  taskChangeReopenedPrefix: "reabrió la tarea",
  taskChangeUnknownActor: "Un usuario",
};

const stageLabelOf = (stage: string) => (stage === "qualified" ? "Calificada" : "Prospecto");

const baseRow = {
  id: "a1",
  createdAt: new Date("2026-01-01"),
  actorName: null,
  personId: null,
  personName: null,
};

test("buildCompanyTimelineViewRows: company-scoped note formats 'Nota · {actor}' and carries the note body", () => {
  const rows = [{ ...baseRow, type: "note", metadata: { note: "Llamó para renovar" }, actorName: "Ana", scope: "company" as const }];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Nota · Ana");
  assert.equal(view.body, "Llamó para renovar");
});

test("buildCompanyTimelineViewRows: company-scoped stage change formats 'from → to' via stageLabelOf", () => {
  const rows = [
    { ...baseRow, type: "status_change", metadata: { from: "prospect", status: "qualified" }, scope: "company" as const },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Etapa cambiada de Prospecto → Calificada");
  assert.equal(view.body, null);
});

test("buildCompanyTimelineViewRows: contact-scoped row prefixes the person's name", () => {
  const rows = [
    { ...baseRow, type: "call", metadata: {}, scope: "contact" as const, personId: "p1", personName: "Bruno Diaz" },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Llamada · Bruno Diaz");
});

test("buildCompanyTimelineViewRows: contact-scoped row with no known name falls back to the bare type label", () => {
  const rows = [{ ...baseRow, type: "email_sent", metadata: {}, scope: "contact" as const, personId: "p1", personName: null }];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Correo");
});

// Owner decision (2026-09-29): any BD may edit/complete/reopen any task, so
// the timeline entry itself must name WHO did it — on the Company timeline
// (unlike Contact's, which already names the actor in its head line), the
// body text is the ONLY place that can, since a contact-scoped row's "what"
// here names the PERSON the task belongs to, not who acted on it.
test("buildCompanyTimelineViewRows: a task_updated row's body names the actor, not just the person", () => {
  const rows = [
    {
      ...baseRow,
      type: "task_updated",
      metadata: {
        taskTitle: "Enviar propuesta",
        changes: [{ field: "dueAt", from: "12 oct", to: "20 oct" }],
      },
      actorName: "Macarena",
      scope: "contact" as const,
      personId: "p1",
      personName: "Bruno Diaz",
    },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Tarea editada · Bruno Diaz");
  assert.equal(view.body, "Macarena editó la tarea «Enviar propuesta»: Vencimiento 12 oct → 20 oct");
});

// --- reply_received (email-sync brief follow-up review) --------------------

test("buildCompanyTimelineViewRows: a reply_received row (always contact-scoped) headlines 'Respuesta recibida · {person}'", () => {
  const rows = [
    {
      ...baseRow,
      type: "reply_received",
      metadata: { subject: "Re: intro", from: "jane@prospect.com" },
      scope: "contact" as const,
      personId: "p1",
      personName: "Bruno Diaz",
    },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.what, "Respuesta recibida · Bruno Diaz");
});

test("buildCompanyTimelineViewRows: a reply_received row's body shows subject and sender, same layout email_sent uses", () => {
  const rows = [
    {
      ...baseRow,
      type: "reply_received",
      metadata: { subject: "Re: intro", from: "jane@prospect.com" },
      scope: "contact" as const,
      personId: "p1",
      personName: "Bruno Diaz",
    },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.body, "Re: intro · jane@prospect.com");
});

test("buildCompanyTimelineViewRows: a reply_received row with no subject/sender falls back to the default copy", () => {
  const rows = [
    { ...baseRow, type: "reply_received", metadata: {}, scope: "contact" as const, personId: "p1", personName: "Bruno Diaz" },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.body, "Respuesta recibida.");
});

test("buildCompanyTimelineViewRows: a task_completed row's body falls back to the unknown-actor label when actorName is null", () => {
  const rows = [
    {
      ...baseRow,
      type: "task_completed",
      metadata: { taskTitle: "Enviar propuesta" },
      actorName: null,
      scope: "company" as const,
    },
  ];
  const [view] = buildCompanyTimelineViewRows(rows, serverStrings, labels, stageLabelOf);
  assert.equal(view.body, "Un usuario completó la tarea «Enviar propuesta»");
});
