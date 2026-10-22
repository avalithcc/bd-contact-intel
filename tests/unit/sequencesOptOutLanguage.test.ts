// The opt-out sentence is in the recipient's language; the postal address stays keyed by address. These tests pin the
// pieces that must move together: the builder takes the language, the send gate accepts ANY configured sentence (stored
// drafts hold the English one), and the advisory detector understands the word the Spanish sentence tells people to reply.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter, bodyHasFooter, buildFooter, splitFooter } from "@/lib/sequences/complianceFooter";
import { complianceRefusal } from "@/lib/sequences/complianceGate";
import { COMPLIANCE_CONFIG, OPT_OUT_TEXT } from "@/lib/sequences/config";
import { composeDraft, footerRemovedOnSave } from "@/lib/sequences/draftCompose";
import { buildReleaseMessage } from "@/lib/sequences/releaseMessage";
import { detectOptOutPhrase } from "@/lib/sequences/optOutPhrases";

import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
const SIGNATURE = '<table><tr><td><b>Jane Doe</b><br>BD Lead</td></tr></table>';
const ADDRESSES = ["mdp", "miami"] as const;
const LANGUAGES = ["es", "en"] as const;

const ENGLISH = 'If you would rather not receive further emails from us, use the link below or simply reply with "unsubscribe".';
const SPANISH = 'Si prefieres no recibir más correos nuestros, usa el enlace de abajo o simplemente responde a este mensaje con la palabra "baja".';

test("the two sentences are pinned by literal text, and the language keys are exactly es and en", () => {
  assert.equal(OPT_OUT_TEXT.en, ENGLISH);
  assert.equal(OPT_OUT_TEXT.es, SPANISH);
  assert.deepEqual(Object.keys(OPT_OUT_TEXT).sort(), ["en", "es"]);
});

test("the footer carries the sentence of its language, for both addresses and both languages", () => {
  for (const address of ADDRESSES) {
    for (const language of LANGUAGES) {
      const f = buildFooter(COMPLIANCE_CONFIG, address, language, URL_OK);
      assert.equal(f.status, "ok");
      if (f.status !== "ok") continue;
      const other = language === "es" ? ENGLISH : SPANISH;
      assert.ok(f.text.includes(OPT_OUT_TEXT[language]), `${address}/${language}`);
      assert.ok(!f.text.includes(other), `${address}/${language} never carries the other language's sentence`);
      assert.ok(f.text.includes(COMPLIANCE_CONFIG[address]!.postalAddress), "the address still follows the ADDRESS key");
    }
  }
});

test("MIGRATION GUARD: bodyHasFooter accepts a body holding EITHER sentence, for either address", () => {
  for (const address of ADDRESSES) {
    for (const sentence of [ENGLISH, SPANISH]) {
      const body = `Hi\n\n--\n${COMPLIANCE_CONFIG[address]!.postalAddress}\n\n${sentence}\n${URL_OK}`;
      assert.equal(bodyHasFooter(body, COMPLIANCE_CONFIG, address), true, `${address}: ${sentence.slice(0, 12)}`);
      assert.equal(footerRemovedOnSave(body, address), false);
      assert.equal(complianceRefusal(address, body, COMPLIANCE_CONFIG), null, "an already stored English draft still passes the send gate");
    }
  }
});

test("bodyHasFooter still demands an opt-out sentence and the right address", () => {
  const miami = COMPLIANCE_CONFIG.miami!.postalAddress;
  assert.equal(bodyHasFooter(`Hi\n${miami}\nno sentence`, COMPLIANCE_CONFIG, "miami"), false);
  assert.equal(bodyHasFooter(`Hi\n${miami}\n${SPANISH}`, COMPLIANCE_CONFIG, "mdp"), false);
});

test("splitFooter cuts a Spanish footer at the address and message + footer is the body unchanged", () => {
  for (const address of ADDRESSES) {
    const r = appendFooter("Hola Ana,\n\nUn mensaje corto.", COMPLIANCE_CONFIG, address, "es", URL_OK);
    assert.equal(r.status, "ok");
    if (r.status !== "ok") continue;
    const parts = splitFooter(r.body, COMPLIANCE_CONFIG);
    assert.ok(parts);
    assert.equal(parts.message + parts.footer, r.body);
    assert.equal(parts.message, "Hola Ana,\n\nUn mensaje corto.\n\n");
    assert.ok(parts.footer.includes(SPANISH) && parts.footer.endsWith(URL_OK));
  }
});

test("composeDraft takes the language: Spanish audience gets the Spanish sentence", () => {
  const es = composeDraft({ subject: "s", body: "Hola" }, "mdp", "es", URL_OK)!;
  const en = composeDraft({ subject: "s", body: "Hello" }, "miami", "en", URL_OK)!;
  assert.ok(es.body.includes(SPANISH) && !es.body.includes(ENGLISH));
  assert.ok(en.body.includes(ENGLISH) && !en.body.includes(SPANISH));
});

test("the composed email for a Spanish audience has the Spanish sentence above a real unsubscribe anchor", () => {
  for (const address of ADDRESSES) {
    const stored = composeDraft({ subject: "s", body: "Hola Ana," }, address, "es", URL_OK)!.body;
    const msg = buildReleaseMessage({
      id: "m-1", sequenceId: "s-1", personId: "p-1", step: 1, email: "ana@example.test", subject: "s", body: stored,
      accountEmail: "sender@mailbox.test", step1RfcMessageId: null, step1ThreadId: null, signatureHtml: SIGNATURE,
    });
    const h = msg.bodyHtml ?? "";
    const iSentence = h.indexOf("Si prefieres no recibir");
    const iLink = h.indexOf(`<a href="${URL_OK}"`);
    assert.ok(iSentence >= 0 && iLink > iSentence, `${address}: ${h}`);
    const anchors = [...h.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].filter(([, href]) => href.includes("/api/unsubscribe"));
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0]?.[1], URL_OK);
  }
});

test("appendFooter does not mutate the config it reads and is repeatable", () => {
  const before = JSON.stringify(COMPLIANCE_CONFIG);
  const a = appendFooter("Hola", COMPLIANCE_CONFIG, "mdp", "es", URL_OK);
  const b = appendFooter("Hola", COMPLIANCE_CONFIG, "mdp", "es", URL_OK);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(COMPLIANCE_CONFIG), before);
});

// ---- the detector ----

test("every new Spanish phrase is detected, accented and unaccented", () => {
  const cases: [string, string][] = [
    ["baja", "Baja, por favor."],
    ["dar de baja", "Pueden dar de baja mi correo"],
    ["dar de baja", "Quiero darme de baja"],
    ["dar de baja", "Pueden darse de baja de la lista"],
    ["desuscribir", "Quiero desuscribirme"],
    ["desuscribir", "Por favor desuscríbanme"],
    ["cancelar suscripcion", "Quiero cancelar mi suscripción"],
    ["cancelar suscripcion", "Quiero cancelar mi suscripcion"],
    ["no me escribas mas", "No me escribas más"],
    ["no me escribas mas", "no me escriban mas por favor"],
    ["no quiero recibir", "No quiero recibir más mensajes"],
    ["quitame de", "Quítame de la lista"],
    ["quitame de", "quitame de la lista"],
    ["quitame de", "Sácame de su base"],
    ["quitame de", "sacame de su base"],
    ["borrar mis datos", "Borren mis datos"],
    ["borrar mis datos", "Pueden eliminar mis datos?"],
  ];
  for (const [phrase, body] of cases) assert.equal(detectOptOutPhrase(body), phrase, body);
});

test("the English phrases are unaffected by the accent folding", () => {
  assert.equal(detectOptOutPhrase("Please unsubscribe me"), "unsubscribe");
  assert.equal(detectOptOutPhrase("Gracias, hablamos la semana próxima."), null);
});

test("a Spanish reply that only QUOTES our Spanish footer raises no prompt (it literally says 'baja')", () => {
  const f = COMPLIANCE_CONFIG.mdp!.postalAddress;
  assert.equal(detectOptOutPhrase(`Gracias!\n\n${OPT_OUT_TEXT.es}\n${URL_OK}`), null);
  assert.equal(detectOptOutPhrase(`Gracias!\n\n${OPT_OUT_TEXT.es.replace(/ (usa|simplemente) /g, "\n$1 ")}`), null, "re-wrapped by a mail client");
  assert.equal(detectOptOutPhrase(`Dale.\n\nEl lun escribió:\n> --\n> ${f}\n> ${OPT_OUT_TEXT.es}`), null);
});

test("baja is deliberately noisy: the detector is advisory and leans toward a prompt (owner decision)", () => {
  assert.equal(detectOptOutPhrase("El proveedor es de baja calidad"), "baja");
});
