/**
 * Unit tests for src/lib/hubspot/statusEvidence.ts — pure past-outreach ->
 * status_backfill activity planning (design D5, tasks 3.5-3.7).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import { planStatusEvidence, statusBackfillIdempotencyKey } from "@/lib/hubspot/statusEvidence";

function contact(overrides: Partial<HubSpotContactRow> = {}): HubSpotContactRow {
  return {
    hubspotContactId: "123",
    firstName: "Jane",
    lastName: "Doe",
    email: null,
    jobTitle: null,
    city: null,
    country: null,
    phone: null,
    linkedinUrl: null,
    ownerRaw: null,
    timesContacted: 0,
    lastContactAt: null,
    lastActivityAt: null,
    createdAt: null,
    leadStatus: "Nuevo",
    associatedCompanyIdPrimary: null,
    associatedCompanyIdPrimaryMultiple: false,
    ...overrides,
  };
}

const RUN_AT = new Date("2026-09-26T12:00:00Z");

// --- Stage evidence (task 3.5) ----------------------------------------------

test("timesContacted > 0 produces a 'contacted' status_backfill activity", () => {
  const plan = planStatusEvidence(contact({ timesContacted: 3 }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "contacted");
});

test("a non-empty lastContactAt produces 'contacted' even with timesContacted 0", () => {
  const plan = planStatusEvidence(contact({ lastContactAt: new Date("2026-01-01T00:00:00Z") }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "contacted");
});

test("leadStatus 'En curso' produces 'contacted'", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "En curso" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "contacted");
});

test("leadStatus 'Conectado' produces 'replied'", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Conectado" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "replied");
});

test("leadStatus 'Mal momento' produces 'replied'", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Mal momento" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "replied");
});

test("'replied' evidence outranks 'contacted' evidence on the same row — only the highest stage backfills", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Conectado", timesContacted: 5 }), null, RUN_AT);
  const stages = plan.activities.filter((a) => a.status === "contacted" || a.status === "replied");
  assert.equal(stages.length, 1);
  assert.equal(stages[0].status, "replied");
});

test("'Nuevo'/'Abierto' with no other evidence writes no activity", () => {
  assert.equal(planStatusEvidence(contact({ leadStatus: "Nuevo" }), null, RUN_AT).activities.length, 0);
  assert.equal(planStatusEvidence(contact({ leadStatus: "Abierto" }), null, RUN_AT).activities.length, 0);
});

// --- Discard evidence (task 3.5) --------------------------------------------

test("leadStatus 'No calificado' produces a discarded status_backfill with reason wrong_profile", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "No calificado" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "discarded");
  assert.equal(plan.activities[0].reason, "wrong_profile");
  assert.equal(plan.activities[0].metadata.status, "discarded");
  assert.equal(plan.activities[0].metadata.reason, "wrong_profile");
});

// --- H6 dry-run fixes: real export lead status values ------------------------

test("leadStatus 'Sin calificar' (the real export value) discards with reason wrong_profile", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Sin calificar" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "discarded");
  assert.equal(plan.activities[0].reason, "wrong_profile");
});

test("leadStatus 'Intento de contacto' produces 'contacted'", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Intento de contacto" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "contacted");
});

test("leadStatus 'Negocio abierto' produces 'replied'", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Negocio abierto" }), null, RUN_AT);
  assert.equal(plan.activities.length, 1);
  assert.equal(plan.activities[0].status, "replied");
});

test("an unrecognized non-empty leadStatus writes no activity but is reported as unknownLeadStatus", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "Algo Raro" }), null, RUN_AT);
  assert.equal(plan.activities.length, 0);
  assert.equal(plan.unknownLeadStatus, "Algo Raro");
});

test("a known leadStatus does not set unknownLeadStatus", () => {
  assert.equal(planStatusEvidence(contact({ leadStatus: "Nuevo" }), null, RUN_AT).unknownLeadStatus, null);
  assert.equal(planStatusEvidence(contact({ leadStatus: "Sin calificar" }), null, RUN_AT).unknownLeadStatus, null);
});

test("an empty leadStatus does not set unknownLeadStatus", () => {
  assert.equal(planStatusEvidence(contact({ leadStatus: null }), null, RUN_AT).unknownLeadStatus, null);
});

test("'No calificado' with contacted evidence emits BOTH a stage and a discard activity, sharing the same originalAt", () => {
  const plan = planStatusEvidence(
    contact({ leadStatus: "No calificado", timesContacted: 2 }),
    null,
    RUN_AT,
  );
  assert.equal(plan.activities.length, 2);
  const statuses = plan.activities.map((a) => a.status).sort();
  assert.deepEqual(statuses, ["contacted", "discarded"]);
  assert.equal(plan.activities[0].metadata.originalAt, plan.activities[1].metadata.originalAt);
});

// --- originalAt resolution (task 3.6) ---------------------------------------

test("originalAt prefers lastContactAt", () => {
  const plan = planStatusEvidence(
    contact({
      timesContacted: 1,
      lastContactAt: new Date("2026-01-10T00:00:00Z"),
      lastActivityAt: new Date("2026-02-10T00:00:00Z"),
      createdAt: new Date("2026-03-10T00:00:00Z"),
    }),
    null,
    RUN_AT,
  );
  assert.equal(plan.originalAt.toISOString(), "2026-01-10T00:00:00.000Z");
  assert.equal(plan.dateFallback, false);
});

test("originalAt falls back to lastActivityAt when lastContactAt is missing", () => {
  const plan = planStatusEvidence(
    contact({
      timesContacted: 1,
      lastContactAt: null,
      lastActivityAt: new Date("2026-02-10T00:00:00Z"),
      createdAt: new Date("2026-03-10T00:00:00Z"),
    }),
    null,
    RUN_AT,
  );
  assert.equal(plan.originalAt.toISOString(), "2026-02-10T00:00:00.000Z");
  assert.equal(plan.dateFallback, false);
});

test("originalAt falls back to createdAt when both contact/activity dates are missing", () => {
  const plan = planStatusEvidence(
    contact({ timesContacted: 1, lastContactAt: null, lastActivityAt: null, createdAt: new Date("2026-03-10T00:00:00Z") }),
    null,
    RUN_AT,
  );
  assert.equal(plan.originalAt.toISOString(), "2026-03-10T00:00:00.000Z");
  assert.equal(plan.dateFallback, false);
});

test("originalAt falls back to run time and sets dateFallback when every date field is missing", () => {
  const plan = planStatusEvidence(
    contact({ timesContacted: 1, lastContactAt: null, lastActivityAt: null, createdAt: null }),
    null,
    RUN_AT,
  );
  assert.equal(plan.originalAt.getTime(), RUN_AT.getTime());
  assert.equal(plan.dateFallback, true);
});

// --- Metadata shape (task 3.5) -----------------------------------------------

test("activity metadata carries originalEditorBdId, source and hubspotContactId", () => {
  const plan = planStatusEvidence(contact({ timesContacted: 1, hubspotContactId: "hs-42" }), "bd-1", RUN_AT);
  assert.equal(plan.activities[0].metadata.originalEditorBdId, "bd-1");
  assert.equal(plan.activities[0].metadata.source, "hubspot_import");
  assert.equal(plan.activities[0].metadata.hubspotContactId, "hs-42");
});

test("originalEditorBdId is null when the row has no owner", () => {
  const plan = planStatusEvidence(contact({ timesContacted: 1 }), null, RUN_AT);
  assert.equal(plan.activities[0].metadata.originalEditorBdId, null);
});

// --- Idempotency key (task 3.7) ---------------------------------------------

test("statusBackfillIdempotencyKey is (hubspotContactId, status)", () => {
  assert.equal(statusBackfillIdempotencyKey("hs-1", "contacted"), "hs-1:contacted");
  assert.notEqual(statusBackfillIdempotencyKey("hs-1", "contacted"), statusBackfillIdempotencyKey("hs-1", "replied"));
  assert.notEqual(statusBackfillIdempotencyKey("hs-1", "contacted"), statusBackfillIdempotencyKey("hs-2", "contacted"));
});

test("each planned activity carries its own idempotencyKey", () => {
  const plan = planStatusEvidence(contact({ leadStatus: "No calificado", timesContacted: 1, hubspotContactId: "hs-9" }), null, RUN_AT);
  const keys = plan.activities.map((a) => a.idempotencyKey).sort();
  assert.deepEqual(keys, ["hs-9:contacted", "hs-9:discarded"]);
});
