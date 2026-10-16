/**
 * Shared layout for every email Avalith CRM sends (approved mockups in
 * openspec/changes/email-templates/mockups/). Pure: no I/O.
 *
 * Email clients drop external stylesheets and most classes, so everything is
 * table-based with inline styles, 600px wide, explicit colors on every cell,
 * `color-scheme: light` and solid-hex borders (several clients discard rgba).
 * The only <style> block is an optional narrow-screen enhancement.
 *
 * Escaping contract: plain-text arguments (subject, labels, titles, eyebrow,
 * reason, hrefs, fact keys, step texts) are escaped HERE. Arguments documented as
 * `html` are inserted verbatim, so callers must escape any data they put in them.
 */
import { DIGEST_FROM_ADDRESS } from "@/lib/mailer/smtpMailer";

// Single-quoted font names: every use sits inside a double-quoted style="...".
export const FONT_STACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/** Literal copies of the `globals.css` tokens (borders are the solid equivalent of rgba(0,0,0,.08) on white). */
export const COLORS = {
  canvas: "#f5f4f7", surface: "#ffffff", surface1: "#fbfafc", line: "#ebebeb",
  ink: "#17151c", soft: "#5b5865", subtle: "#6e6b78", muted: "#8b8894",
  accent: "#d5252f", accentStrong: "#b81f27", accentSoft: "#fae5e6", accentFg: "#ffffff",
  warnBg: "#f6eae1", warnText: "#92400e", dangerBg: "#fbe5e5", dangerText: "#b91c1c",
  infoBg: "#e4eafa", infoText: "#1e40af",
} as const;
const C = COLORS;

export type Tone = "warn" | "danger" | "info";
const TONES: Record<Tone, [string, string]> = {
  warn: [C.warnBg, C.warnText],
  danger: [C.dangerBg, C.dangerText],
  info: [C.infoBg, C.infoText],
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

/** Paragraph; `html` is trusted markup, `extra` extra inline declarations. */
export function emailParagraph(html: string, extra = ""): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${C.ink};${extra}">${html}</p>`;
}

/**
 * Primary button: a padded link inside a colored cell. No conditional comments (Supabase's Go html/template strips
 * every HTML comment), so it must work in every client as-is; `mso-padding-alt` keeps the padding in desktop Outlook.
 */
export function emailButton(label: string, href: string): string {
  return `<table ${TABLE} style="margin:8px 0 20px;"><tr>
<td align="center" bgcolor="${C.accent}" style="border-radius:6px;background-color:${C.accent};mso-padding-alt:13px 28px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT_STACK};font-size:15px;font-weight:700;line-height:20px;color:${C.accentFg};text-decoration:none;border-radius:6px;background-color:${C.accent};">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/** "Copy this link" line under a button, link shown in mono. */
export function emailFallbackLink(href: string): string {
  const h = escapeHtml(href);
  return emailParagraph(
    `Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br><a href="${h}" style="font-family:${MONO_STACK};font-size:12px;color:${C.accentStrong};word-break:break-all;text-decoration:underline;">${h}</a>`,
    `font-size:13px;color:${C.subtle};margin-bottom:8px;`,
  );
}

/** Tinted box with a colored left rule: bold `title` (text) over `html`. */
export function emailCallout(tone: Tone, title: string, html: string): string {
  const [bg, fg] = TONES[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
<td bgcolor="${bg}" style="background-color:${bg};border-radius:8px;border-left:4px solid ${fg};padding:14px 16px;font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${C.ink};">
<div style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${fg};margin:0 0 4px;">${escapeHtml(title)}</div>${html}</td></tr></table>`;
}

/** Bulleted list; each item is `html`. */
export function emailBullets(items: string[]): string {
  const cell = `font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${C.ink};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${items
    .map(
      (i) =>
        `<tr><td width="20" valign="top" style="${cell}color:${C.accent};">&bull;</td><td style="${cell}padding:0 0 6px;">${i}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Numbered steps; `title` and `sub` are text. */
export function emailSteps(items: Array<[title: string, sub?: string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${items
    .map(
      ([title, sub], i) => `<tr>
<td width="40" valign="top" style="padding:0 0 12px;"><table ${TABLE}><tr><td align="center" width="28" height="28" bgcolor="${C.accentSoft}" style="width:28px;height:28px;background-color:${C.accentSoft};border-radius:14px;font-family:${MONO_STACK};font-size:12px;font-weight:700;color:${C.accentStrong};">${i + 1}</td></tr></table></td>
<td valign="top" style="padding:3px 0 12px;font-family:${FONT_STACK};font-size:15px;line-height:1.5;color:${C.ink};"><strong>${escapeHtml(title)}</strong>${sub ? `<br><span style="font-size:13px;color:${C.subtle};">${escapeHtml(sub)}</span>` : ""}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Key/value card; keys are text, values are `html`. */
export function emailFacts(rows: Array<[key: string, html: string]>): string {
  const border = (i: number) => (i ? `border-top:1px solid ${C.line};` : "");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${rows
    .map(
      ([k, v], i) =>
        `<tr><td width="40%" bgcolor="${C.surface1}" style="padding:10px 14px;${border(i)}background-color:${C.surface1};font-family:${MONO_STACK};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${C.soft};">${escapeHtml(k)}</td><td style="padding:10px 14px;${border(i)}font-family:${FONT_STACK};font-size:14px;color:${C.ink};">${v}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Rounded status pill; `text` is escaped. */
export function emailPill(text: string, tone: Tone, extra = ""): string {
  const [bg, fg] = TONES[tone];
  return `<span style="display:inline-block;white-space:nowrap;padding:3px 10px;border-radius:999px;font-family:${MONO_STACK};font-size:11px;font-weight:700;background-color:${bg};color:${fg};${extra}">${escapeHtml(text)}</span>`;
}

export interface EmailLayoutInput {
  subject: string;
  preheader: string;
  /** Mono label above the title, rendered as "// eyebrow". */
  eyebrow: string;
  title: string;
  /** Trusted markup built with the helpers above. */
  bodyHtml: string;
  /** Why the recipient gets this email (footer, text). */
  reason: string;
  /** True when a reply reaches the administrators (a Reply-To is set). */
  replies: boolean;
  /** Extra CSS appended to the narrow-screen media query. */
  mobileCss?: string;
}

function footerLine(replies: boolean): string {
  const replyLine = replies
    ? "Podés responder este correo: tu respuesta llega a la administración del CRM."
    : "Este buzón no recibe respuestas, por favor no respondas a este correo.";
  return `Mensaje automático de Avalith CRM, enviado desde ${DIGEST_FROM_ADDRESS}. ${replyLine}`;
}

/** Full HTML document: header wordmark, white card with the red top rule, footer on the canvas. */
export function renderEmail(input: EmailLayoutInput): string {
  const small = `margin:0 0 8px;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${C.subtle};`;
  return `<!doctype html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<title>${escapeHtml(input.subject)}</title>
<style>
  /* Progressive enhancement only: every layout-critical value is inline. */
  @media only screen and (max-width: 480px) {
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
    .outer { padding: 16px 8px !important; }${input.mobileCss ?? ""}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};">${escapeHtml(input.preheader)}${"&nbsp;&zwnj;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background-color:${C.canvas};">
<tr><td align="center" class="outer" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:0 4px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT_STACK};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${C.ink};">avalith<span style="color:${C.accent};">.</span></td>
<td align="right" style="font-family:${MONO_STACK};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.subtle};">CRM</td>
</tr></table></td></tr>
<tr><td bgcolor="${C.surface}" style="background-color:${C.surface};border:1px solid ${C.line};border-top:4px solid ${C.accent};border-radius:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pad" style="padding:30px 36px 14px;">
<div style="font-family:${MONO_STACK};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.subtle};margin:0 0 10px;">// ${escapeHtml(input.eyebrow)}</div>
<h1 style="margin:0 0 18px;font-family:${FONT_STACK};font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(input.title)}</h1>
${input.bodyHtml}
</td></tr></table></td></tr>
<tr><td class="pad" style="padding:20px 8px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${C.subtle};">
<p style="${small}">${escapeHtml(input.reason)}</p>
<p style="${small}">${escapeHtml(footerLine(input.replies))}</p>
<p style="margin:12px 0 0;font-family:${FONT_STACK};font-size:13px;font-weight:800;letter-spacing:-0.02em;color:${C.muted};">avalith<span style="color:${C.accent};">.</span></p>
</td></tr>
</table></td></tr></table>
</body>
</html>`;
}

/** Plain-text twin: the caller's text body followed by the same reason and footer as the HTML. */
export function renderEmailText(input: { body: string; reason: string; replies: boolean }): string {
  return `${input.body.trim()}\n\n${input.reason}\n${footerLine(input.replies)}\n`;
}
