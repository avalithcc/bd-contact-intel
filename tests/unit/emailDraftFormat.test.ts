/**
 * Unit tests for src/lib/outreach/emailDraftFormat.ts — the UI-facing
 * "Asunto: X\n\n<body>" combined-draft format used by
 * GenerateOutreachMessageResult.message for the email channel (see
 * generateMessage.ts) and split back apart by the "Usar en correo" action
 * on the record page (QuickActions.tsx), which may run over a draft the
 * BD has since edited by hand in the "Borrador" textarea.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatEmailDraft, splitEmailDraft } from "@/lib/outreach/emailDraftFormat";

test("formatEmailDraft combines subject and body with a blank line", () => {
  assert.equal(formatEmailDraft("Hola", "Cuerpo"), "Asunto: Hola\n\nCuerpo");
});

test("splitEmailDraft is the inverse of formatEmailDraft", () => {
  const draft = formatEmailDraft("Squads nearshore", "Hola Valentina,\n\nGracias por tu tiempo.");
  assert.deepEqual(splitEmailDraft(draft), {
    subject: "Squads nearshore",
    body: "Hola Valentina,\n\nGracias por tu tiempo.",
  });
});

test("splitEmailDraft trims subject and body", () => {
  assert.deepEqual(splitEmailDraft("Asunto:   Hola   \n\n  Cuerpo  "), { subject: "Hola", body: "Cuerpo" });
});

test("splitEmailDraft falls back to an empty subject when the text has no Asunto: prefix (edited/linkedin draft)", () => {
  assert.deepEqual(splitEmailDraft("Hola, esto no tiene formato de asunto"), {
    subject: "",
    body: "Hola, esto no tiene formato de asunto",
  });
});
