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
  atStatusChange: "Cambio de etapa",
  atMeetingLogged: "Reunión",
  atCall: "Llamada",
  atDiscarded: "Descartado",
  atHunterLookup: "Búsqueda",
  atStatusBackfill: "Historial",
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
