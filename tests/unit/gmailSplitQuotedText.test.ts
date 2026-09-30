import assert from "node:assert/strict";
import { test } from "node:test";
import { splitQuotedText } from "@/lib/gmail/splitQuotedText";

test("splits at a Spanish Gmail quote header ('... escribió:')", () => {
  const body = [
    "Gracias Cristian, sumo a nuestro director de plataforma. ¿Podemos hablar el 21?",
    "",
    "El 13 oct de 2026, 16:02, Cristian Civita <cristian@avalith.net> escribió:",
    "> Valentina, en seguimiento a la nota de Juan: adjunto nuestro caso de estudio…",
  ].join("\n");
  const result = splitQuotedText(body);
  assert.equal(result.main, "Gracias Cristian, sumo a nuestro director de plataforma. ¿Podemos hablar el 21?");
  assert.ok(result.quoted?.startsWith("El 13 oct de 2026"));
});

test("splits at an English Gmail quote header ('... wrote:')", () => {
  const body = ["Sounds good.", "", "On Oct 13, 2026, at 4:02 PM, Jane Doe <jane@acme.com> wrote:", "> Hi there"].join(
    "\n",
  );
  const result = splitQuotedText(body);
  assert.equal(result.main, "Sounds good.");
  assert.ok(result.quoted?.startsWith("On Oct 13, 2026"));
});

test("falls back to the first '>' quoted line when there's no recognized header", () => {
  const body = ["Perfect, see you then.", "", "> original message text", "> more quoted text"].join("\n");
  const result = splitQuotedText(body);
  assert.equal(result.main, "Perfect, see you then.");
  assert.equal(result.quoted, "> original message text\n> more quoted text");
});

test("returns no quoted text when the body has no quote marker at all", () => {
  const body = "Perfecto, envío una invitación para el martes 21, 11:00 ART.";
  const result = splitQuotedText(body);
  assert.equal(result.main, body);
  assert.equal(result.quoted, null);
});

test("an empty body yields empty main and no quoted text", () => {
  const result = splitQuotedText("");
  assert.equal(result.main, "");
  assert.equal(result.quoted, null);
});
