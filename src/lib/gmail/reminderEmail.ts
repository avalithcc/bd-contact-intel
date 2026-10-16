/**
 * Copy and markup of the "connect your Gmail" reminder (gmail-reminder-email; approved mockup
 * openspec/changes/gmail-reminder-email/mockups/recordatorio-gmail.html) and of the short notice the owner gets with
 * reminder #3. Pure: no I/O, no SMTP. Styling reuses the digest's inlined tokens (src/lib/tasks/digest.ts).
 */
import { DIGEST_FROM_ADDRESS } from "@/lib/mailer/smtpMailer";
import {
  COLOR_ACCENT,
  COLOR_ACCENT_FG,
  COLOR_BORDER,
  COLOR_CANVAS,
  COLOR_INK,
  COLOR_INK_MUTED,
  COLOR_INK_SOFT,
  COLOR_SURFACE_2,
  FONT_STACK,
  escapeHtml,
} from "@/lib/tasks/digest";

export interface ReminderEmail {
  subject: string;
  html: string;
  text: string;
}

/** The first name when `name` looks like one; null for an empty value or an auto-provisioned email local part. */
export function greetingName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}+$/u.test(first) ? first : null;
}

function layout(subject: string, bodyHtml: string, footer: string): string {
  const p = `margin:0 0 14px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${COLOR_INK};`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR_CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR_CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${COLOR_SURFACE_2};border:1px solid ${COLOR_BORDER};border-radius:12px;">
<tr><td style="padding:28px 32px 8px;">${bodyHtml.replaceAll("<p>", `<p style="${p}">`)}</td></tr>
<tr><td style="padding:8px 32px 24px;border-top:1px solid ${COLOR_BORDER};"><p style="margin:16px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${COLOR_INK_MUTED};">${footer}</p></td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** `siteBaseUrl` has no trailing slash (getSiteUrl). The one link goes to the Gmail connect page. */
export function buildReminderEmail(recipient: { name: string }, siteBaseUrl: string): ReminderEmail {
  const subject = "Es clave que conectes tu Gmail al CRM";
  const url = `${siteBaseUrl}/account/email`;
  const first = greetingName(recipient.name);
  const hello = first ? `Hola ${first},` : "Hola,";
  const footer = `Recibís este aviso porque tu Gmail está sin conectar. Dejamos de mandarlo apenas lo conectes. Es un mensaje automático de Avalith CRM, enviado desde ${escapeHtml(DIGEST_FROM_ADDRESS)}.`;

  const body = `<p>${escapeHtml(hello)}</p>
<p>Hace unos días que no entrás al CRM y tu Gmail todavía <strong>no está conectado</strong>. <strong>Es clave que lo conectes:</strong> es lo que hace que el CRM funcione para vos.</p>
<p>Mientras siga desconectado:</p>
<ul style="margin:0 0 14px;padding-left:22px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${COLOR_INK};">
<li>Tus correos y las respuestas de tus contactos <strong>no entran al CRM</strong>, así que no queda registro de lo que hablás.</li>
<li>Tus <strong>Secuencias están pausadas</strong>: no sale ningún envío.</li>
</ul>
<p>Son dos minutos: entrás, elegís tu cuenta de Google y listo.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${COLOR_ACCENT_FG};background-color:${COLOR_ACCENT};text-decoration:none;border-radius:6px;">Conectar mi Gmail</a></p>
<p style="color:${COLOR_INK_SOFT};">Si el botón no anda, copiá este link: ${escapeHtml(url)}</p>
<p>Cualquier problema, escribile a Cristian.</p>`;

  const text = [
    hello,
    "",
    "Hace unos días que no entrás al CRM y tu Gmail todavía no está conectado. Es clave que lo conectes: es lo que hace que el CRM funcione para vos.",
    "",
    "Mientras siga desconectado:",
    "- Tus correos y las respuestas de tus contactos no entran al CRM, así que no queda registro de lo que hablás.",
    "- Tus Secuencias están pausadas: no sale ningún envío.",
    "",
    "Son dos minutos: entrás, elegís tu cuenta de Google y listo.",
    "",
    `Conectar mi Gmail: ${url}`,
    "",
    "Cualquier problema, escribile a Cristian.",
    "",
    `Recibís este aviso porque tu Gmail está sin conectar. Dejamos de mandarlo apenas lo conectes. Es un mensaje automático de Avalith CRM, enviado desde ${DIGEST_FROM_ADDRESS}.`,
    "",
  ].join("\n");

  return { subject, html: layout(subject, body, footer), text };
}

/** Sent to the admin(s) when reminder #3 goes out: the automation stops here and a person takes over. */
export function buildOwnerNoticeEmail(bd: { name: string; email: string }): ReminderEmail {
  const subject = `${bd.name} sigue sin conectar Gmail`;
  const line = `Le mandamos 3 recordatorios por email a ${bd.name} (${bd.email}) y todavía no conectó su Gmail. No le mandamos más: conviene hablarle directamente.`;
  const body = `<p>${escapeHtml(line)}</p>`;
  const footer = `Aviso automático de Avalith CRM, enviado desde ${escapeHtml(DIGEST_FROM_ADDRESS)}.`;
  return { subject, html: layout(subject, body, footer), text: `${line}\n` };
}
