/**
 * Pure extractor of the sender's own phone number from one inbound message
 * body (scripts/extract-signature-phones.ts). No I/O, no DB. Three traps:
 *
 * 1. QUOTE BOUNDARIES: a body carries the whole thread history, with every
 *    participant's signature. `cutAtQuoteBoundary` keeps only what the sender
 *    wrote in THIS message: it cuts at the EARLIEST of every marker below and
 *    drops the rest. Bottom-posted replies lose their text (conservative).
 *    No marker found: boundary is null and the whole body is kept; the caller
 *    counts those separately because they are the risky ones.
 * 2. NUMBERS THAT ARE NOT PHONES: CUIT/CUIL, dates, times, postal codes,
 *    order/invoice/bank references, fax lines, anything inside a URL or an
 *    email address, wrong lengths. A survivor must also carry a phone label on
 *    the same line (tel, cel, móvil, whatsapp...) or be an unlabeled
 *    international "+" number of 10+ digits. Everything else is "unlabeled".
 * 3. ATTRIBUTION is not decided here: see plan.ts and db.ts.
 *
 * Kind comes from the label only (mobile / explicit landline / generic).
 * The stored value is the dialable part: extension dropped, dots turned into
 * spaces (src/lib/phone.ts does not accept them), validated with phone.ts.
 */
import { isValidPhoneFormat } from "@/lib/phone";

export type QuoteBoundary = "wrote_header" | "dashed_original" | "outlook_rule" | "header_block" | "quoted_line" | "forwarded";
export type RejectReason = "url" | "email" | "cuit" | "date" | "postal" | "reference" | "fax" | "too_short" | "too_long" | "invalid" | "unlabeled";
/** What the LABEL says, never the number's shape. "generic" = a bare "Tel:"/"Phone:" or an unlabelled "+" number: the kind is not stated. */
export type PhoneKind = "mobile" | "landline" | "generic";

export interface PhoneCandidate {
  value: string;
  kind: PhoneKind;
  extensionDropped: boolean;
}
export interface ExtractResult {
  boundary: QuoteBoundary | null;
  phones: PhoneCandidate[];
  rejected: Partial<Record<RejectReason, number>>;
}

const WROTE_ONE_LINE = /^(?:on|el)\s.{3,}\s(?:wrote|escribi[oó]):$/i;
const WROTE_TAIL = /^(?:wrote|escribi[oó]):$/i;
const WROTE_HEAD = /^(?:on|el)\s/i;
const DASHED_ORIGINAL = /^-{2,}\s*(?:original message|mensaje original)\s*-{2,}$/i;
const DASHED_FORWARD = /^-{2,}\s*(?:forwarded message|mensaje reenviado)\s*-{2,}$/i;
const OUTLOOK_RULE = /^_{5,}$/;
const HEADER_FIRST = /^[*\s]*(?:from|de)\s*:[*\s]*\S/i;
const HEADER_SIBLING = /^[*\s]*(?:sent|enviado(?: el)?|date|fecha|to|para|cc|subject|asunto)\s*:/i;

/** Earliest quote marker wins; `text` is everything above it. */
export function cutAtQuoteBoundary(body: string): { text: string; boundary: QuoteBoundary | null } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let cut = lines.length;
  let boundary: QuoteBoundary | null = null;
  const mark = (index: number, kind: QuoteBoundary) => {
    if (index < cut) {
      cut = index;
      boundary = kind;
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (raw.trimStart().startsWith(">")) mark(i, "quoted_line");
    else if (WROTE_ONE_LINE.test(line)) mark(i, "wrote_header");
    else if (WROTE_TAIL.test(line)) {
      let head = i;
      while (head > 0 && i - head < 3 && !WROTE_HEAD.test(lines[head]!.trim())) head--;
      mark(WROTE_HEAD.test(lines[head]!.trim()) ? head : i, "wrote_header");
    } else if (DASHED_ORIGINAL.test(line)) mark(i, "dashed_original");
    else if (DASHED_FORWARD.test(line)) mark(i, "forwarded");
    else if (OUTLOOK_RULE.test(line)) mark(i, "outlook_rule");
    else if (HEADER_FIRST.test(line) && lines.slice(i + 1, i + 6).some((l) => HEADER_SIBLING.test(l.trim()))) mark(i, "header_block");
  });
  return { text: lines.slice(0, cut).join("\n"), boundary };
}

const NUM = String.raw`(?:\(\d{1,5}\)|\d+)`;
const SEP = String.raw`(?:[  ]?[./-][  ]?|[  ])`;
const EXT = String.raw`(?:[  ]*(?:ext|int|interno|anexo|x)\.?[  ]*\d+)`;
const CANDIDATE = new RegExp(String.raw`(?<![A-Za-z0-9])\+?[  ]?${NUM}(?:${SEP}${NUM})*(${EXT})?(?![A-Za-z0-9])`, "gi");
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const B = String.raw`(?<![a-záéíóúñ])`;
const TAIL = String.raw`\s*[:.\-–|]?\s*$`;
const MOBILE_LABEL = new RegExp(`${B}(?:cel(?:ular)?|cell(?:phone)?|m[oó]vil|mobile|mob|whats\\s?app|wsp|wpp)${TAIL}|${B}[mc]\\s*:\\s*$`, "i");
const LANDLINE_LABEL = new RegExp(`${B}(?:(?:tel(?:[eé]fono)?|phone)\\s*)?(?:fijo|landline|l[ií]nea fija)${TAIL}`, "i");
const PHONE_LABEL = new RegExp(`${B}(?:tel(?:[eé]fono)?|tlf|phone|fono|directo)${TAIL}|${B}t\\s*:\\s*$`, "i");
const FAX_LABEL = new RegExp(`${B}fax${TAIL}`, "i");
const CUIT_LABEL = new RegExp(`${B}(?:cuit|cuil|cdi)${TAIL}`, "i");
const POSTAL_LABEL = new RegExp(`${B}(?:c\\.?\\s?p\\.?|c[oó]digo postal|postal|zip(?: code)?)${TAIL}`, "i");
const REFERENCE_LABEL = new RegExp(
  `${B}(?:factura|fact|pedido|orden|order|invoice|nro|num(?:ero)?|ref(?:erencia)?|cotizaci[oó]n|presupuesto|remito|ticket|id|cbu|cuenta|iban|oc|po|expediente|legajo|dni|pasaporte)\\s*[:.\\-–#]?\\s*(?:n[º°o]\\.?\\s*)?$|[nN][º°]\\s*$|#\\s*$`,
  "i",
);

const inside = (spans: readonly [number, number][], at: number) => spans.some(([from, to]) => at >= from && at < to);
const spansOf = (re: RegExp, text: string): [number, number][] => [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length]);

/** Digits with a leading "+": the one key for comparing numbers across formats. */
export function phoneKey(value: string): string {
  return `${value.trim().startsWith("+") ? "+" : ""}${value.replace(/\D/g, "")}`;
}

export function extractSenderPhones(body: string): ExtractResult {
  const { text, boundary } = cutAtQuoteBoundary(body);
  const urls = spansOf(URL_RE, text);
  const emails = spansOf(EMAIL_RE, text);
  const rejected: ExtractResult["rejected"] = {};
  const reject = (reason: RejectReason) => void (rejected[reason] = (rejected[reason] ?? 0) + 1);
  const found = new Map<string, PhoneCandidate>();

  for (const m of text.matchAll(CANDIDATE)) {
    const at = m.index!;
    if (inside(urls, at)) {
      reject("url");
      continue;
    }
    if (inside(emails, at)) {
      reject("email");
      continue;
    }
    const extension = m[1] !== undefined;
    const raw = (extension ? m[0].slice(0, m[0].length - m[1]!.length) : m[0]).replace(/ /g, " ").trim();
    const digits = raw.replace(/\D/g, "");
    const prefix = text.slice(text.lastIndexOf("\n", at - 1) + 1, at);

    if (CUIT_LABEL.test(prefix) || /^\d{2}[ .-]\d{8}[ .-]\d$/.test(raw) || (/^(?:20|23|24|25|26|27|30|33|34)\d{9}$/.test(raw) && !raw.startsWith("+"))) reject("cuit");
    else if (REFERENCE_LABEL.test(prefix)) reject("reference");
    else if (POSTAL_LABEL.test(prefix)) reject("postal");
    else if (FAX_LABEL.test(prefix)) reject("fax");
    else if (digits.length <= 8 && /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(raw)) reject("date");
    else if (digits.length < 8) reject("too_short");
    else if (digits.length > 15) reject("too_long");
    else {
      const value = raw.replace(/[./]/g, " ").replace(/\s+/g, " ").trim();
      const kind: PhoneKind | null = MOBILE_LABEL.test(prefix) ? "mobile" : LANDLINE_LABEL.test(prefix) ? "landline" : PHONE_LABEL.test(prefix) ? "generic" : null;
      if (raw.includes("/") || /^(\d)\1+$/.test(digits) || !isValidPhoneFormat(value)) reject("invalid");
      else if (!kind && !(value.startsWith("+") && digits.length >= 10)) reject("unlabeled");
      else if (!found.has(phoneKey(value))) found.set(phoneKey(value), { value, kind: kind ?? "generic", extensionDropped: extension });
    }
  }
  return { boundary, phones: [...found.values()], rejected };
}
