/**
 * follow-up-expiry: the three timeline rows, built from the REAL producers' metadata (buildDroppedMetadata /
 * buildExpiredMetadata) and the real es dictionary, so a renamed metadata key breaks here and not in production.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { es } from "@/lib/i18n/dictionaries/es";
import { buildDroppedMetadata, buildExpiredMetadata } from "@/lib/followUp/cycle";
import { followUpEntryText } from "@/lib/followUp/entryText";

const l = pickContactRecordLabels(es as never);

test("a BD drop names the BD and the reason, and says the pipeline status did not change", () => {
  const metadata = buildDroppedMetadata({ reason: "no_response", detail: null, cycleStartedOn: "2026-09-17", status: "contacted" });
  const view = followUpEntryText({ type: "follow_up_dropped", actorName: "Martín Rivas", metadata }, l);
  assert.equal(view?.headline, "Dado de baja del seguimiento por Martín Rivas — Sin respuesta después de varios intentos");
  assert.equal(view?.body, "El contacto sigue en el pipeline con el estado Contactado.");
  assert.equal(view?.system, false);
});

test("a free-text detail leads the body of a BD drop", () => {
  const metadata = buildDroppedMetadata({ reason: "other", detail: "Cambió de rubro", cycleStartedOn: "2026-09-17", status: "replied" });
  const view = followUpEntryText({ type: "follow_up_dropped", actorName: "Martín Rivas", metadata }, l);
  assert.equal(view?.headline, "Dado de baja del seguimiento por Martín Rivas — Otro");
  assert.equal(view?.body, "Cambió de rubro. El contacto sigue en el pipeline con el estado Respondió.");
});

test("the automatic drop is a system row that states the queue entry date", () => {
  const metadata = buildExpiredMetadata("2026-10-17", "2026-10-27", "contacted");
  const view = followUpEntryText({ type: "follow_up_expired", actorName: null, metadata }, l);
  assert.equal(view?.headline, "Seguimiento vencido sin acción — dado de baja automáticamente (10 días en la cola sin seguimiento)");
  assert.match(view!.body, /^Entró a la cola el 17 oct y pasaron 10 días sin acción\. El estado sigue en Contactado\./);
  assert.equal(view?.system, true);
});

test("the re-entry row and a type that is not ours", () => {
  const view = followUpEntryText({ type: "follow_up_reentered", actorName: null, metadata: { cycleStartedOn: "2026-10-17" } }, l);
  assert.equal(view?.headline, "Volvió a Seguimientos — hubo actividad nueva");
  assert.equal(view?.system, true);
  assert.equal(followUpEntryText({ type: "note", actorName: null, metadata: {} }, l), null);
});

test("missing or malformed metadata never prints a placeholder", () => {
  const view = followUpEntryText({ type: "follow_up_expired", actorName: null, metadata: null }, l);
  assert.ok(view && !/[{}]/.test(view.headline + view.body), view?.body);
  const dropped = followUpEntryText({ type: "follow_up_dropped", actorName: null, metadata: { reason: "ghost" } }, l);
  assert.ok(dropped && !/[{}]/.test(dropped.headline + dropped.body), dropped?.headline);
});
