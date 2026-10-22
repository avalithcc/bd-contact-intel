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
    ["no me escribas", "No me escribas más"],
    ["no me escribas", "no me escriban mas por favor"],
    ["no quiero recibir", "No quiero recibir más mensajes"],
    ["quitame", "Quítame de la lista"],
    ["quitame", "quitame de la lista"],
    ["quitame", "Sácame de su base"],
    ["quitame", "sacame de su base"],
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
  // Not under a ">" and not under an attribution line, so ONLY the KNOWN_FOOTER_TEXT strip can silence it (the old
  // "El lun escribió:\n> ..." variant was silenced by the ">" stripping and never exercised the strip).
  assert.equal(detectOptOutPhrase(`Dale.\n\n--\n${f}\n\n${OPT_OUT_TEXT.es}`), null);
});

test("baja is deliberately noisy: the detector is advisory and leans toward a prompt (owner decision)", () => {
  assert.equal(detectOptOutPhrase("El proveedor es de baja calidad"), "baja");
});

test("a client that smart-quotes our own footer still cannot raise a prompt (curly quotes are folded)", () => {
  const curly = (t: string) => t.replace(/"([^"]*)"/g, "\u201c$1\u201d").replace(/'/g, "\u2019");
  for (const text of Object.values(OPT_OUT_TEXT)) {
    assert.notEqual(curly(text), text, "the fixture really contains curly quotes");
    assert.equal(detectOptOutPhrase(`Gracias.\n\n${curly(text)}`), null);
  }
});

test("INVARIANT: the word each sentence tells people to reply with is detected on its own (derived from the config)", () => {
  for (const [language, text] of Object.entries(OPT_OUT_TEXT)) {
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    assert.equal(quoted.length, 1, `${language}: the sentence names exactly one reply word between double quotes`);
    for (const word of quoted) {
      assert.notEqual(detectOptOutPhrase(word), null, `${language}: replying "${word}" must be recognised, or the footer promises an opt-out that does not work`);
      assert.notEqual(detectOptOutPhrase(word.toUpperCase()), null, `${language}: ${word} in capitals`);
    }
  }
});

test("recall: how people actually write an opt-out request (Spanish), accented or not, tu / usted / ustedes", () => {
  const bodies = [
    // "no me <verb>" with no trailing qualifier
    "No me escribas", "no me escriban", "No me escriba", "no me contacte", "No me contacten", "no me contactes",
    "No me llame", "no me llamen", "no me mande nada", "no me manden mails", "No me envie mas", "no me envien correos",
    // stop doing it
    "Dejen de escribirme", "deja de escribirme por favor", "Dejar de escribirme", "dejar de recibir sus correos", "Deje de enviarme correos",
    // I do not want
    "No quiero seguir recibiendo sus correos", "No quiero más correos", "no quiero mas mails", "No quiero recibir más", "No quiero recibir nada",
    // enough
    "Basta de correos", "basta de mails", "Basta de emails por favor",
    // remove me, with and without "de"
    "Quítenme", "quitenme por favor", "Sacarme", "Sáquenme", "saquenme", "Retírenme", "retirenme", "Elimínenme", "eliminenme", "Bórrenme", "borrenme",
    // remove my address
    "Elimine mi correo", "borre mi correo de su lista", "Eliminar mi email", "sacar mi correo de su base", "Borren mi mail", "Retiren mi correo",
  ];
  for (const body of bodies) assert.notEqual(detectOptOutPhrase(body), null, body);
});

test("recall stays broad on purpose everywhere else: an unqualified 'no me llames, no es el momento' prompts (advisory)", () => {
  assert.notEqual(detectOptOutPhrase("No me llames, no es el momento"), null);
});

test("measured: 12 real opt-outs are all flagged (recall must not move)", () => {
  const optOuts = [
    "no me escribas", "no me contacten", "dejen de escribirme", "No quiero mas correos", "Basta de correos", "quitenme",
    "retirenme de la lista", "elimine mi correo de su base", "no quiero seguir recibiendo correos", "baja", "darme de baja", "desuscribirme",
  ];
  const missed = optOuts.filter((b) => detectOptOutPhrase(b) === null);
  assert.deepEqual(missed, []);
});

// MEASURED false positives, not hypotheticals: of 12 realistic replies that mean INTEREST, the first five raised an
// opt-out prompt before the three channel-swap / idiom / correction patterns were narrowed. The last seven were already
// quiet and must stay quiet. A swap ("write me HERE instead") always supplies an alternative; a real opt-out never does.
test("measured: replies that mean interest do NOT raise an opt-out prompt", () => {
  const interested = [
    "Hola Cristian, me interesa. Quiero sacarme una duda sobre los perfiles.",
    "Gracias! Antes de avanzar quiero sacarme una duda.",
    "Dale, hablemos. No me llames a este numero, mejor al +54 9 11 5555 5555.",
    "Me interesa pero no me escribas a este mail, escribime al corporativo.",
    "Podrias borrar mis datos del formulario viejo y usar estos?",
    // the seven that were already quiet (synthetic stand-ins of the same kind)
    "Me interesa, cuando podemos hablar?",
    "Gracias por escribirme, tenemos una busqueda abierta de dos developers.",
    "Mandame mas detalles de los perfiles y las tarifas.",
    "Estoy de vacaciones hasta el lunes, te escribo cuando vuelva.",
    "Pasame tu calendario y coordinamos una llamada.",
    "Interesante propuesta, lo comparto con el equipo.",
    "Podemos hablar el jueves a las 15?",
  ];
  const noisy = interested.filter((b) => detectOptOutPhrase(b) !== null);
  assert.deepEqual(noisy, []);
});

test("the narrowing is surgical: the same verbs without an alternative, or a duda-less sacar, still prompt", () => {
  assert.notEqual(detectOptOutPhrase("No me llames mas por favor"), null);
  assert.notEqual(detectOptOutPhrase("Sacame de la lista, tengo una duda de por que me escriben"), null);
  assert.notEqual(detectOptOutPhrase("Borren mis datos de su base."), null);
  assert.notEqual(detectOptOutPhrase("No me escribas. Escribile a mi colega."), null, "a redirect in ANOTHER sentence does not excuse the opt-out");
});

// A reply that names a replacement contact is STILL an opt-out for the person writing it: "stop writing to ME, my
// colleague is X" asks us to stop. That is why the channel-swap exemption is redirect WORDS only ("mejor", "escribime",
// "y usar") and never the mere presence of an address or number. Measured: counting contact details lost 3 of 8 opt-outs.
test("recall: an opt-out that names a replacement contact is still flagged (the exemption is words-only)", () => {
  const optOuts = [
    "no me escribas, mi colega es laura@acme.com",
    "elimine mi correo de su base, mi mail es juan@acme.com",
    "no me contacten, el responsable es +54 11 5555 5555",
  ];
  assert.deepEqual(optOuts.filter((b) => detectOptOutPhrase(b) === null), []);
});
