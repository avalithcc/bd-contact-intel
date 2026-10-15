// Task 10.7: advisory opt-out detection in a reply body. Detection only ever PROMPTS the BD; these tests also pin that
// the module has no way to write (no DB, no suppression import), so it cannot suppress by itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMPLIANCE_CONFIG } from "../../src/lib/sequences/config";
import { detectOptOutPhrase } from "../../src/lib/sequences/optOutPhrases";

test("the four advisory phrases are detected, case-insensitively and inside a sentence", () => {
  assert.equal(detectOptOutPhrase("Please UNSUBSCRIBE me."), "unsubscribe");
  assert.equal(detectOptOutPhrase("Could you remove me from your list?"), "remove me");
  assert.equal(detectOptOutPhrase("Stop emailing me, thanks."), "stop emailing");
  assert.equal(detectOptOutPhrase("No more emails please"), "no more emails");
});

test("an ordinary reply, an empty body and a missing body detect nothing", () => {
  assert.equal(detectOptOutPhrase("Thanks, happy to talk next week."), null);
  assert.equal(detectOptOutPhrase(""), null);
  assert.equal(detectOptOutPhrase(null), null);
});

test("our own footer, quoted back in a reply, is NOT an opt-out request (it literally says 'unsubscribe')", () => {
  const quote = `Sounds good, send the details.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Cristian <bd@avalith.net> wrote:\n> --\n> ${COMPLIANCE_CONFIG.us!.optOutText}`;
  assert.equal(detectOptOutPhrase(quote), null);
  const outlook = `Sounds good.\n\n-----Original Message-----\nFrom: Cristian\n${COMPLIANCE_CONFIG.us!.optOutText}`;
  assert.equal(detectOptOutPhrase(outlook), null);
  assert.equal(detectOptOutPhrase(`> ${COMPLIANCE_CONFIG.us!.optOutText}\nplease unsubscribe me`), "unsubscribe");
});

const FOOTER = COMPLIANCE_CONFIG.us!.optOutText;
const LINK = "https://bd-contact-intel.vercel.app/api/unsubscribe?t=" + "A".repeat(43);

test("Spanish quote markers: Gmail 'El ... escribió:' and Outlook 'Mensaje original' / De: Enviado: blocks never prompt", () => {
  assert.equal(detectOptOutPhrase(`Dale, mandame el detalle.\n\nEl lun, 12 oct 2026 a las 9:00, Cristian <bd@avalith.net> escribió:\n> ${FOOTER}\n> ${LINK}`), null);
  assert.equal(detectOptOutPhrase(`Gracias.\n\n-----Mensaje original-----\nDe: Cristian\nEnviado: lunes\n${FOOTER}\n${LINK}`), null);
  assert.equal(detectOptOutPhrase(`Gracias.\n\nDe: Cristian <bd@avalith.net>\nEnviado: lunes, 12 de octubre de 2026 9:00\nPara: Jane\nAsunto: hola\n\n${FOOTER}`), null);
});

test("PRIMARY net: our known footer text and unsubscribe link are removed, so a quote with no marker and no '>' cannot prompt", () => {
  assert.equal(detectOptOutPhrase(`Thanks!\n\n${FOOTER}\n${LINK}`), null);
  assert.equal(detectOptOutPhrase(`Thanks!\n\n${FOOTER.replace(/ (use|simply) /g, "\n$1 ")}`), null, "re-wrapped by a mail client");
  assert.equal(detectOptOutPhrase(LINK), null);
});

test("LEANS toward detecting: a body line that merely starts 'From:' or a bottom-posted reply under a quote is NOT cut off", () => {
  assert.equal(detectOptOutPhrase("From: Argentina, we are a small team.\nPlease remove me from your list."), "remove me");
  assert.equal(detectOptOutPhrase("Hola\n\nFrom: our Buenos Aires office\nstop emailing us"), "stop emailing");
  assert.equal(detectOptOutPhrase(`On Mon, Oct 12, 2026 Cristian wrote:\n> ${FOOTER}\n\nPlease unsubscribe me.`), "unsubscribe");
  assert.equal(detectOptOutPhrase(`Please unsubscribe me.\n\nEl lun escribió:\n> ${FOOTER}`), "unsubscribe");
});

test("detection is advisory: the module imports nothing that can write", () => {
  const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "sequences", "optOutPhrases.ts"), "utf8");
  assert.doesNotMatch(source, /^import .*(@\/db|drizzle-orm|Queries)/m);
});
