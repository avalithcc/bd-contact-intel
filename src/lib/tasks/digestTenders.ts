/**
 * The tender block of the 08:30 digest: pure types and rendering, no I/O. Which tenders reach which BD is decided by
 * `planTenderDigest` (src/lib/tenders/digestPlan.ts); this file only draws them.
 */
import { COLORS as C, FONT_STACK, emailPill, escapeHtml, type Tone } from "@/lib/mailer/emailLayout";

export interface DigestTender {
  id: string;
  processNumber: string;
  name: string;
  openingAt: Date;
  /** Argentina calendar days to the opening day; 0 is today. */
  daysLeft: number;
}

export interface DigestTenders {
  /** Owned by this BD and closing within TENDER_OWN_WINDOW_DAYS. */
  mine: DigestTender[];
  /** Relevant, nobody's, closing within TENDER_UNOWNED_WINDOW_DAYS: sent to every BD because nobody else will be told. */
  unowned: DigestTender[];
}

export const NO_TENDERS: DigestTenders = { mine: [], unowned: [] };

export const tenderCount = (t: DigestTenders): number => t.mine.length + t.unowned.length;

const MAX_ROWS = 20;

const closesIn = (n: number): string => (n <= 0 ? "cierra hoy" : n === 1 ? "cierra mañana" : `cierra en ${n} días`);

function block(heading: string, hint: string, all: readonly DigestTender[], siteBaseUrl: string): { text: string; html: string } {
  if (all.length === 0) return { text: "", html: "" };
  const shown = all.slice(0, MAX_ROWS);
  const hidden = all.length - shown.length;
  const url = (t: DigestTender) => `${siteBaseUrl}/licitaciones/${t.id}`;
  const tone = (t: DigestTender): Tone => (t.daysLeft <= 1 ? "danger" : "warn");
  const rows = shown.map((t, i) => ({
    text: `- ${t.name} (${t.processNumber}) — ${closesIn(t.daysLeft)} ${url(t)}`,
    html:
      `<tr><td style="padding:12px 16px;${i === shown.length - 1 && hidden === 0 ? "" : `border-bottom:1px solid ${C.line};`}">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${C.ink};word-break:break-word;"><a href="${escapeHtml(url(t))}" style="color:${C.accentStrong};text-decoration:none;">${escapeHtml(t.name)}</a>` +
      `<div style="font-weight:400;font-size:12px;color:${C.soft};">${escapeHtml(t.processNumber)}</div></td>` +
      `<td align="right" style="padding-left:12px;white-space:nowrap;">${emailPill(closesIn(t.daysLeft), tone(t))}</td>` +
      `</tr></table></td></tr>`,
  }));
  const moreText = `y ${hidden} más en el CRM`;
  const moreRow = hidden
    ? `<tr><td style="padding:12px 16px;font-family:${FONT_STACK};font-size:13px;"><a href="${escapeHtml(`${siteBaseUrl}/licitaciones`)}" style="color:${C.accentStrong};text-decoration:none;font-weight:700;">${moreText}</a></td></tr>`
    : "";
  const text = `${heading} (${all.length})\n${hint}\n${rows.map((r) => r.text).join("\n")}\n${hidden ? `${moreText}: ${siteBaseUrl}/licitaciones\n` : ""}`;
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">` +
    `<tr><td style="padding:0 0 4px;font-family:${FONT_STACK};font-size:15px;font-weight:800;color:${C.ink};">${escapeHtml(heading)} ${emailPill(String(all.length), "danger", "margin-left:4px;padding:2px 8px;")}</td></tr>` +
    `<tr><td style="padding:0 0 10px;font-family:${FONT_STACK};font-size:13px;color:${C.soft};">${escapeHtml(hint)}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${rows.map((r) => r.html).join("")}${moreRow}</table></td></tr></table>`;
  return { text, html };
}

/** "Tus licitaciones por cerrar" then "Licitaciones sin responsable"; either is omitted when empty. */
export function renderTenderSections(t: DigestTenders, siteBaseUrl: string): { text: string; html: string } {
  const parts = [
    block("Tus licitaciones por cerrar", "Cierran en los próximos 7 días. Una vez que cierran no se puede presentar.", t.mine, siteBaseUrl),
    block("Licitaciones sin responsable", "Son relevantes, cierran en los próximos 14 días y nadie las tomó. Asignate una desde su ficha.", t.unowned, siteBaseUrl),
  ].filter((p) => p.text !== "");
  return { text: parts.map((p) => p.text).join("\n"), html: parts.map((p) => p.html).join("") };
}
