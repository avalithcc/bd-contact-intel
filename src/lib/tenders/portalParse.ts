/**
 * PURE ON PURPOSE: HTML in, fields out, no `@/db`, no network. COMPR.AR's pages are ASP.NET WebForms, so every value sits in a
 * `<span id="ctl00_..._lblSomething">`; the prefix is generated, the suffix is the stable name, and that suffix is what is matched.
 * A field the page does not carry is `null` ("the portal does not state it"), never an empty string and never a failure.
 */
import { parseOpeningDate } from "@/lib/tenders/parse";

export interface PortalFields {
  objeto: string | null;
  currency: string | null;
  contractDuration: string | null;
  /** "Plazo mantenimiento de la oferta", as the portal words it ("45 Días corridos Acto de apertura"). */
  offerValidity: string | null;
  acceptsExtension: boolean | null;
  questionsUntil: Date | null;
  /** The portal's own "acto de apertura": it can differ from the sheet's `tender.opening_at` when the date moves. */
  openingAt: Date | null;
  guaranteeOffer: string | null;
  guaranteeContract: string | null;
  guaranteeChallenge: string | null;
  /** Acts in the administrative-acts grid that are circulars. 0 when none is listed. */
  circularCount: number;
}

export type PortalParse = { ok: true; fields: PortalFields } | { ok: false; reason: "not_citizen_view" };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const squash = (s: string): string => unescapeHtml(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Text of the span whose id ends in `_<name>`; null when absent or blank. */
function spanText(html: string, name: string): string | null {
  const m = new RegExp(`<span[^>]*\\sid="[^"]*_${name}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
  if (!m) return null;
  const text = squash(m[1] ?? "");
  return text === "" ? null : text;
}

const portalDate = (raw: string | null): Date | null => (raw ? parseOpeningDate(raw) : null);

function yesNo(raw: string | null): boolean | null {
  const v = raw?.toLowerCase();
  return v === "sí" || v === "si" ? true : v === "no" ? false : null;
}

/**
 * Rows of the CIRCULARES grid, one `lblNumero` per circular.
 *
 * This counted the administrative-acts grid instead, looking for acts whose document named a circular, and it was wrong
 * on the first real case: 64-0021-LPR26 has THREE circulars and only TWO "Autorización circular" acts, because one act
 * can publish more than one. A circular can change what the pliego demands - on that tender one lowered the minimum
 * technical score from 75 to 60 points out of 100 - so undercounting them hides the very thing the field exists to
 * surface. The acts grid was never the right source; the circulars grid is.
 */
function countCirculars(html: string): number {
  return (html.match(/_gvCirculares_ctl\d+_lblNumero"/g) ?? []).length;
}

/** The citizen view (`VistaPreviaPliegoCiudadano.aspx`). Anything that is not that page is a failure value, never a throw. */
export function parseCitizenView(html: string): PortalParse {
  if (typeof html !== "string" || !html.includes("UC_InformacionBasica_")) return { ok: false, reason: "not_citizen_view" };
  return {
    ok: true,
    fields: {
      objeto: spanText(html, "lblObjetoContratacion"),
      currency: spanText(html, "lblMoneda"),
      contractDuration: spanText(html, "lblMontoDuracionDuracionContrato"),
      offerValidity: spanText(html, "lblPlazoMantenimientoOferta"),
      acceptsExtension: yesNo(spanText(html, "lblAceptaProrroga")),
      questionsUntil: portalDate(spanText(html, "lblFechaFinalConsultas")),
      openingAt: portalDate(spanText(html, "lblFechaActoApertura")),
      guaranteeOffer: spanText(html, "AclaracionGarantiaMantenimiento"),
      guaranteeContract: spanText(html, "AclaracionGarantiaCumplimiento"),
      guaranteeChallenge: spanText(html, "lblImpugnacionPread"),
      circularCount: countCirculars(html),
    },
  };
}

export interface FormState {
  viewState: string;
  viewStateGenerator: string;
  /** Legitimately absent on some pages: empty, not an error. */
  eventValidation: string;
}

function hiddenValue(html: string, name: string): string | null {
  const tag = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html);
  if (!tag) return null;
  const value = /\svalue="([^"]*)"/.exec(tag[0]);
  return value ? unescapeHtml(value[1] ?? "") : "";
}

/** The ASP.NET hidden fields every postback must echo. Null when the page has no VIEWSTATE (not a WebForms page). */
export function readFormState(html: string): FormState | null {
  const viewState = hiddenValue(html, "__VIEWSTATE");
  if (viewState === null) return null;
  return { viewState, viewStateGenerator: hiddenValue(html, "__VIEWSTATEGENERATOR") ?? "", eventValidation: hiddenValue(html, "__EVENTVALIDATION") ?? "" };
}

export interface SearchPage {
  /** 0 = the portal found nothing (a normal outcome); null = the page says neither, so it is not the results page. */
  resultCount: number | null;
  /** The `__doPostBack` target of the first result row. Read from the page: its `ctlNN` index is not stable. */
  rowTarget: string | null;
}

export function parseSearchPage(html: string): SearchPage {
  const found = /Se han encontrado \((\d+)\)/.exec(html);
  const resultCount = found ? Number(found[1]) : /No se han encontrado resultados/.test(html) ? 0 : null;
  const row = /__doPostBack\((?:&#39;|')(ctl00\$CPH1\$GridListaPliegos\$ctl\d+\$lnkNumeroProceso)(?:&#39;|')/.exec(html);
  return { resultCount, rowTarget: row?.[1] ?? null };
}
