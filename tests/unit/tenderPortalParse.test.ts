import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCitizenView, parseSearchPage, readFormState } from "@/lib/tenders/portalParse";
import { parseOpeningDate } from "@/lib/tenders/parse";

// Real pages saved from COMPR.AR (public, no login) - never hand-built, so the parser is held to what the portal really emits.
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const citizen = read("comprar-citizen-view.html");
const hit = read("comprar-search-hit.html");
const empty = read("comprar-search-empty.html");

test("the citizen view yields every field the portal states", () => {
  const r = parseCitizenView(citizen);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const f = r.fields;
  assert.match(f.objeto ?? "", /^Servicios profesionales para el soporte y mantenimiento del Sistema Integrado de Gestión Contable, Financiero y Presupuestario ESIGA/);
  assert.equal(f.currency, "Peso Argentino");
  assert.equal(f.contractDuration, "12 Meses");
  assert.equal(f.offerValidity, "45 Días corridos Acto de apertura");
  assert.equal(f.acceptsExtension, true);
  assert.deepEqual(f.questionsUntil, parseOpeningDate("09/12/2026 10:00 Hrs."));
  assert.deepEqual(f.openingAt, parseOpeningDate("15/12/2026 10:00 Hrs."));
  assert.equal(f.questionsUntil?.toISOString(), "2026-12-09T13:00:00.000Z");
  assert.equal(f.guaranteeOffer, "La garantía de mantenimiento de oferta debe ser del 5,00% sobre el monto total de la oferta");
  assert.equal(f.guaranteeContract, "La garantía de cumplimiento de contrato debe ser del 10,00% del monto del contrato");
  assert.match(f.guaranteeChallenge ?? "", /^La garantía de impugnación a la evaluación deber ser del tres por ciento \(3%\)/);
  assert.equal(f.circularCount, 0);
});

test("a field the page does not carry is null, not an empty string and not a failure", () => {
  const stripped = citizen.replace(/<span id="[^"]*_lblPlazoMantenimientoOferta">[^<]*<\/span>/, "").replace(/<span id="[^"]*_lblAceptaProrroga">[^<]*<\/span>/, `<span id="x_lblAceptaProrroga">Quizás</span>`);
  const r = parseCitizenView(stripped);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fields.offerValidity, null);
  assert.equal(r.fields.acceptsExtension, null);
  assert.equal(r.fields.currency, "Peso Argentino");
});

test("'No' on the extension is false, distinct from not stated", () => {
  const r = parseCitizenView(citizen.replace(/(_lblAceptaProrroga">)Sí/, "$1No"));
  assert.ok(r.ok && r.fields.acceptsExtension === false);
});

/**
 * Counted against a REAL page that really has circulars, not an edited one.
 *
 * The first version of this counted the administrative-acts grid and was wrong on the first live tender: 64-0021-LPR26
 * publishes THREE circulars through only TWO "Autorización circular" acts. The old test passed because it was built by
 * renaming two acts inside a page that has no circulars at all, so it could only ever confirm the implementation it was
 * written from. A fixture that cannot contain the defect cannot catch it.
 */
const circulars = read("comprar-citizen-view-circulars.html");

test("circulars are the rows of the circulars grid, not the acts that published them", () => {
  const r = parseCitizenView(circulars);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.fields.circularCount, 3);
  // The same page: two acts name a circular. Counting those is what gave 2.
  assert.equal((circulars.match(/Autorización circular/g) ?? []).length, 2);
});

test("a tender with no circulars counts zero, and the acts grid cannot inflate it", () => {
  const r = parseCitizenView(citizen);
  assert.ok(r.ok && r.fields.circularCount === 0);
  assert.ok(citizen.includes("Autorización pliego"), "the acts grid is present, so zero is a real count and not an absent section");
});

test("malformed or foreign HTML is a failure, never a throw", () => {
  for (const html of ["", "<html><body>Servicio no disponible</body></html>", "<span id=", "\u0000\u0001", hit]) {
    const r = parseCitizenView(html);
    assert.deepEqual(r, { ok: false, reason: "not_citizen_view" });
  }
});

test("the search results page gives the row's postback target, never a hardcoded ctl02", () => {
  assert.deepEqual(parseSearchPage(hit), { resultCount: 1, rowTarget: "ctl00$CPH1$GridListaPliegos$ctl02$lnkNumeroProceso" });
  const shifted = hit.replaceAll("GridListaPliegos$ctl02", "GridListaPliegos$ctl07");
  assert.equal(parseSearchPage(shifted).rowTarget, "ctl00$CPH1$GridListaPliegos$ctl07$lnkNumeroProceso");
});

test("zero results is its own answer; an unrecognised page is neither", () => {
  assert.deepEqual(parseSearchPage(empty), { resultCount: 0, rowTarget: null });
  assert.deepEqual(parseSearchPage("<html>nope</html>"), { resultCount: null, rowTarget: null });
});

test("the form state is read and HTML-unescaped; a missing EVENTVALIDATION is empty, not an error", () => {
  const s = readFormState(hit);
  assert.ok(s && s.viewState.length > 100);
  assert.ok(s.viewStateGenerator.length > 0);
  assert.ok(!/&amp;|&#43;|&#39;/.test(s.viewState));
  const noEv = hit.replace(/<input[^>]*name="__EVENTVALIDATION"[^>]*>/, "");
  assert.equal(readFormState(noEv)?.eventValidation, "");
  assert.equal(readFormState("<html></html>"), null);
});

test("parsing is repeatable on the same input", () => {
  assert.deepEqual(parseCitizenView(citizen), parseCitizenView(citizen));
});
