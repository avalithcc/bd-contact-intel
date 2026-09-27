/**
 * Unit test for signalLabelsFromDict (src/lib/outreach/messageLabels.ts) —
 * builds the OutreachSignalLabels bag consumed by formatOutreachSignalLabel
 * from the plain-string, {n}/{date}-templated dictionary fields (same
 * placeholder-swap convention as generateMessageHistoryHintOne/Many).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { signalLabelsFromDict, pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { formatOutreachSignalLabel } from "@/lib/outreach/messageSignalLabels";
import { t } from "@/lib/i18n/dictionaries";

test("signalLabelsFromDict + formatOutreachSignalLabel render Spanish singular/plural correctly", () => {
  const labels = signalLabelsFromDict(pickGenerateMessageLabels(t("es")));
  assert.equal(formatOutreachSignalLabel({ kind: "hiring", count: 1 }, labels), "Contratando · 1 puesto de IT");
  assert.equal(formatOutreachSignalLabel({ kind: "hiring", count: 5 }, labels), "Contratando · 5 puestos de IT");
  assert.equal(
    formatOutreachSignalLabel({ kind: "notesPresent", count: 1 }, labels),
    "Nota de investigación disponible",
  );
  assert.equal(
    formatOutreachSignalLabel({ kind: "notesPresent", count: 3 }, labels),
    "3 notas de investigación disponibles",
  );
  assert.equal(
    formatOutreachSignalLabel({ kind: "lastContact", date: "2026-02-15" }, labels),
    "Último contacto: 2026-02-15",
  );
});
