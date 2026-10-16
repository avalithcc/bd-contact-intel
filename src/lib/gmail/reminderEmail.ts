/**
 * Copy and markup of the "connect your Gmail" reminder and of the short notice the owner gets with reminder #3
 * (approved mockups: openspec/changes/email-templates/mockups/{recordatorio-gmail,aviso-administracion}.html).
 * Pure: no I/O, no SMTP. The frame comes from src/lib/mailer/emailLayout.ts.
 */
import {
  COLORS,
  MONO_STACK,
  emailBullets,
  emailButton,
  emailCallout,
  emailFacts,
  emailFallbackLink,
  emailParagraph,
  emailPill,
  emailSteps,
  escapeHtml,
  renderEmail,
  renderEmailText,
} from "@/lib/mailer/emailLayout";

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

const REMINDER_REASON = "Recibís este aviso porque tu Gmail está sin conectar. Dejamos de enviarlo apenas lo conectes.";
const OWNER_REASON =
  "Recibís este aviso porque sos administrador de Avalith CRM. Se envía una sola vez por persona, junto con el tercer recordatorio.";
const LOST = "Tus correos y las respuestas de tus contactos no entran al CRM, así que no queda registro de lo que conversás.";
const PAUSED = "Tus Secuencias están pausadas: no sale ningún envío.";
const STEPS: Array<[string, string]> = [
  ["Abrí el CRM", "Desde el botón de abajo."],
  ["Elegí tu cuenta de Google", "Autorizá el acceso cuando Google lo pida."],
  ["Listo", "Tus correos empiezan a registrarse solos."],
];

/** `siteBaseUrl` has no trailing slash (getSiteUrl). The one link goes to the Gmail connect page. Replies reach the admins (Reply-To). */
export function buildReminderEmail(recipient: { name: string }, siteBaseUrl: string): ReminderEmail {
  const subject = "Es clave que conectes tu Gmail al CRM";
  const url = `${siteBaseUrl}/account/email`;
  const first = greetingName(recipient.name);
  const hello = first ? `Hola ${first},` : "Hola,";

  const bodyHtml =
    emailParagraph(escapeHtml(hello)) +
    emailCallout("warn", "Tu Gmail todavía no está conectado", "Hace unos días que no entrás al CRM. Conectarlo es lo que hace que el CRM funcione para vos.") +
    emailParagraph("Mientras siga desconectado:", "margin-bottom:8px;") +
    emailBullets([
      LOST.replace("no entran al CRM", "<strong>no entran al CRM</strong>"),
      PAUSED.replace("Secuencias están pausadas", "<strong>Secuencias están pausadas</strong>"),
    ]) +
    emailParagraph("<strong>Son dos minutos:</strong>", "margin-bottom:12px;") +
    emailSteps(STEPS) +
    emailButton("Conectar mi Gmail", url) +
    emailFallbackLink(url) +
    emailParagraph("¿Algún problema para conectarlo? Respondé a este correo y te ayudamos.", `font-size:14px;color:${COLORS.soft};margin-bottom:12px;`);

  const html = renderEmail({
    subject,
    preheader: "Mientras esté desconectado, tus correos no entran al CRM y tus Secuencias siguen pausadas.",
    eyebrow: "Aviso · Gmail",
    title: "Conectá tu Gmail al CRM",
    bodyHtml,
    reason: REMINDER_REASON,
    replies: true,
  });
  const text = renderEmailText({
    body: [
      hello,
      "",
      "Tu Gmail todavía no está conectado. Hace unos días que no entrás al CRM. Conectarlo es lo que hace que el CRM funcione para vos.",
      "",
      "Mientras siga desconectado:",
      `- ${LOST}`,
      `- ${PAUSED}`,
      "",
      "Son dos minutos:",
      ...STEPS.map(([t], i) => `${i + 1}. ${t}.`),
      "",
      `Conectar mi Gmail: ${url}`,
      "",
      "¿Algún problema para conectarlo? Respondé a este correo y te ayudamos.",
    ].join("\n"),
    reason: REMINDER_REASON,
    replies: true,
  });
  return { subject, html, text };
}

/** Sent to the admin(s) when reminder #3 goes out: the automation stops here and a person takes over. No button: there is no screen to link to. */
export function buildOwnerNoticeEmail(bd: { name: string; email: string }): ReminderEmail {
  const subject = `${bd.name} sigue sin conectar Gmail`;
  const intro = `Enviamos 3 recordatorios por correo a ${bd.name} y todavía no conectó su Gmail. No le enviaremos más: conviene hablarle directamente.`;
  const consequence = "Mientras su Gmail siga desconectado, sus correos no se registran en el CRM y sus Secuencias permanecen pausadas.";

  const bodyHtml =
    emailParagraph(escapeHtml(intro)) +
    emailFacts([
      ["Persona", escapeHtml(bd.name)],
      ["Correo", `<span style="font-family:${MONO_STACK};font-size:13px;">${escapeHtml(bd.email)}</span>`],
      ["Recordatorios enviados", "3 de 3"],
      ["Estado de Gmail", emailPill("Sin conectar", "warn")],
    ]) +
    emailCallout("info", "Qué sigue", escapeHtml(consequence));

  const html = renderEmail({
    subject,
    preheader: "Ya recibió 3 recordatorios por correo. No enviaremos más: conviene hablarle directamente.",
    eyebrow: "Aviso a administración",
    title: "Un BD sigue sin conectar Gmail",
    bodyHtml,
    reason: OWNER_REASON,
    replies: false,
  });
  const text = renderEmailText({
    body: `${intro}\n\nPersona: ${bd.name}\nCorreo: ${bd.email}\nRecordatorios enviados: 3 de 3\nEstado de Gmail: sin conectar\n\n${consequence}`,
    reason: OWNER_REASON,
    replies: false,
  });
  return { subject, html, text };
}
