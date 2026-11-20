import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_TENDER_DOCUMENT_BYTES } from "@/lib/tenders/document";
import { fetchPliegoPdf, pliegoFilename } from "@/lib/tenders/pliegoFetch";
import { parsePliegoTarget } from "@/lib/tenders/portalParse";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const citizen = read("comprar-citizen-view.html");
const hit = read("comprar-search-hit.html");

const TARGET = "ctl00$CPH1$UCVistaPreviaPliego$UC_Clausulas$gvActosAdministrativos$ctl";
const row = (grid: string, n: string, label: string) =>
  `<span id="ctl00_CPH1_UCVistaPreviaPliego_${grid}_gvActosAdministrativos_ctl${n}_lblDocumento">${label}</span>` +
  `<a id="ctl00_CPH1_UCVistaPreviaPliego_${grid}_gvActosAdministrativos_ctl${n}_btnVer" href="javascript:__doPostBack(&#39;ctl00$CPH1$UCVistaPreviaPliego$${grid}$gvActosAdministrativos$ctl${n}$btnVer&#39;,&#39;&#39;)">Ver</a>`;

test("the real citizen view yields its Clausulas Particulares target, read from the page", () => {
  assert.equal(parsePliegoTarget(citizen), `${TARGET}02$btnVer`);
});

test("picks the row by its document label, not by position, and only from the Clausulas grid", () => {
  const html = row("UC_ActosAdministrativos", "02", "Autorización pliego") + row("UC_Clausulas", "02", "Anexo") + row("UC_Clausulas", "05", "Clausulas Particulares") + row("UC_Clausulas", "06", "Cláusulas Particulares bis");
  assert.equal(parsePliegoTarget(html), `${TARGET}05$btnVer`);
});

test("no particular-clauses row means no target", () => {
  assert.equal(parsePliegoTarget(row("UC_Clausulas", "02", "Anexo")), null);
  assert.equal(parsePliegoTarget(row("UC_ActosAdministrativos", "02", "Clausulas Particulares")), null);
});

test("filename comes from content-disposition, with a safe fallback", () => {
  assert.equal(pliegoFilename('attachment;filename="PLIEG-2026-103373875-APN-SF#SRT.pdf"', "64-0021-LPR26"), "PLIEG-2026-103373875-APN-SF#SRT.pdf");
  assert.equal(pliegoFilename(null, "64-0021-LPR26"), "pliego-64-0021-LPR26.pdf");
  assert.equal(pliegoFilename('attachment;filename="x.exe"', "64-0021-LPR26"), "pliego-64-0021-LPR26.pdf");
});

function portal(body: BodyInit | null, init: ResponseInit & { citizenHtml?: string } = {}) {
  const calls: { url: string; target: string | null; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, req?: RequestInit) => {
    const url = String(input);
    const form = typeof req?.body === "string" ? new URLSearchParams(req.body) : null;
    calls.push({ url, target: form?.get("__EVENTTARGET") ?? null, headers: Object.fromEntries(Object.entries((req?.headers ?? {}) as Record<string, string>)) });
    const target = form?.get("__EVENTTARGET") ?? "";
    if (target.endsWith("$btnVer")) return new Response(body, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment;filename="P.pdf"' }, ...init });
    if (url.includes("VistaPreviaPliegoCiudadano")) return new Response(init.citizenHtml ?? citizen);
    if (!form) return new Response(hit);
    if (target === "ctl00$CPH1$btnListarPliegoNumero") return new Response(hit);
    return new Response(null, { status: 302, headers: { location: "/PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=q" } });
  }) as typeof fetch;
  return { impl, calls };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

test("a real PDF body comes back as bytes with its filename, via the target read from the citizen page", async () => {
  const { impl, calls } = portal(PDF);
  const out = await fetchPliegoPdf("64-0021-LPR26", { fetchImpl: impl });
  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.deepEqual([...out.bytes], [...PDF]);
  assert.equal(out.filename, "P.pdf");
  const last = calls[calls.length - 1]!;
  assert.equal(last.target, `${TARGET}02$btnVer`);
  assert.ok(last.url.includes("VistaPreviaPliegoCiudadano"));
  for (const c of calls) assert.equal(c.headers["User-Agent"], "tender-monitor/1.0");
});

test("a body that is not a PDF is refused even with a pdf content-type", async () => {
  const out = await fetchPliegoPdf("X", { fetchImpl: portal("<html>error page</html>").impl });
  assert.deepEqual(out, { kind: "not_pdf" });
});

test("an oversized body is refused, by declared length before reading and by actual length after", async () => {
  const declared = await fetchPliegoPdf("X", { fetchImpl: portal(PDF, { headers: { "content-type": "application/pdf", "content-length": String(MAX_TENDER_DOCUMENT_BYTES + 1) } }).impl });
  assert.deepEqual(declared, { kind: "too_large" });
  const big = new Uint8Array(MAX_TENDER_DOCUMENT_BYTES + 1);
  big.set(PDF);
  assert.deepEqual(await fetchPliegoPdf("X", { fetchImpl: portal(big).impl }), { kind: "too_large" });
});

test("a citizen view without a particular-clauses row is no_document; an empty search is not_found", async () => {
  const noRow = citizen.replace(/Clausulas Particulares/g, "Otro");
  assert.deepEqual(await fetchPliegoPdf("X", { fetchImpl: portal(PDF, { citizenHtml: noRow }).impl }), { kind: "no_document" });
  const emptyImpl = (async () => new Response(read("comprar-search-empty.html"))) as typeof fetch;
  assert.deepEqual(await fetchPliegoPdf("X", { fetchImpl: emptyImpl }), { kind: "not_found" });
});

test("a network failure is an error outcome, never a throw", async () => {
  const out = await fetchPliegoPdf("X", { fetchImpl: (async () => { throw new Error("socket hang up"); }) as typeof fetch });
  assert.equal(out.kind, "error");
});
