/**
 * Unit tests for src/lib/outreach/messageSignalLabels.ts — turns a pure
 * OutreachSignal (messageSignals.ts) into a display string for the
 * "Señales utilizadas" chips, using caller-supplied localized templates
 * (the i18n dictionaries) rather than hardcoding any language here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOutreachSignalLabel, type OutreachSignalLabels } from "@/lib/outreach/messageSignalLabels";

const LABELS: OutreachSignalLabels = {
  hiring: (n) => `Hiring:${n}`,
  leadership: "Leadership",
  repliedBefore: "RepliedBefore",
  notesPresent: (n) => `Notes:${n}`,
  lastContact: (date) => `LastContact:${date}`,
};

test("formats each signal kind using the matching template", () => {
  assert.equal(formatOutreachSignalLabel({ kind: "hiring", count: 3 }, LABELS), "Hiring:3");
  assert.equal(formatOutreachSignalLabel({ kind: "leadership" }, LABELS), "Leadership");
  assert.equal(formatOutreachSignalLabel({ kind: "repliedBefore" }, LABELS), "RepliedBefore");
  assert.equal(formatOutreachSignalLabel({ kind: "notesPresent", count: 2 }, LABELS), "Notes:2");
  assert.equal(
    formatOutreachSignalLabel({ kind: "lastContact", date: "2026-02-15" }, LABELS),
    "LastContact:2026-02-15",
  );
});
