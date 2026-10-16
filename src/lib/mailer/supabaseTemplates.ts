/**
 * The two Supabase Auth emails that can fire today (Reset Password, Invite user), built with the same layout as
 * the app's own emails (approved mockups: openspec/changes/email-templates/mockups/{restablecer-contrasena,invitacion}.html).
 * Supabase only reads what is pasted in its dashboard, so `scripts/build-supabase-email-templates.ts` writes the
 * output to `supabase/email-templates/`. The bodies carry Supabase's Go-template actions ({{ .SiteURL }},
 * {{ .TokenHash }}, {{ .Email }}); none of them contains a character `escapeHtml` touches.
 */
import {
  COLORS,
  emailButton,
  emailCallout,
  emailFallbackLink,
  emailParagraph,
  emailSteps,
  renderEmail,
} from "@/lib/mailer/emailLayout";

/** Supabase renders with Go html/template, which drops every HTML comment; this mirrors that for previews and tests. */
export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

export interface SupabaseTemplate {
  subject: string;
  html: string;
}

/** Same link shape `/auth/confirm` verifies (src/lib/auth/passwordReset.ts, scripts/create-bd.ts). */
const link = (type: "recovery" | "invite") => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`;
const note = (text: string) => emailParagraph(text, `font-size:14px;color:${COLORS.soft};margin-bottom:12px;`);

export function buildRecoveryTemplate(): SupabaseTemplate {
  const subject = "Restablecé tu contraseña de Avalith CRM";
  const href = link("recovery");
  const bodyHtml =
    emailParagraph("Recibimos una solicitud para restablecer la contraseña de la cuenta <strong>{{ .Email }}</strong>.") +
    emailParagraph("Tocá el botón para elegir una contraseña nueva:", "margin-bottom:6px;") +
    emailButton("Restablecer contraseña", href) +
    emailFallbackLink(href) +
    emailCallout("info", "Por tu seguridad", "El enlace es personal, de un solo uso y vence pronto. Si caduca, volvé a pedir uno desde «¿Olvidaste tu contraseña?» en la pantalla de acceso.") +
    note("<strong>¿No fuiste vos?</strong> Ignorá este correo: tu contraseña actual sigue siendo la misma.");
  const html = renderEmail({
    subject,
    preheader: "Usá este enlace para elegir una contraseña nueva. Si no fuiste vos, ignorá este correo.",
    eyebrow: "Seguridad de la cuenta",
    title: "Restablecé tu contraseña",
    bodyHtml,
    reason: "Recibís este correo porque alguien pidió restablecer la contraseña de {{ .Email }} en Avalith CRM.",
    replies: false,
  });
  return { subject, html };
}

export function buildInviteTemplate(): SupabaseTemplate {
  const subject = "Te damos la bienvenida a Avalith CRM";
  const href = link("invite");
  const bodyHtml =
    emailParagraph("Un administrador te invitó a <strong>Avalith CRM</strong> con la cuenta <strong>{{ .Email }}</strong>.") +
    emailParagraph("Creá tu contraseña para entrar por primera vez:", "margin-bottom:6px;") +
    emailButton("Crear mi contraseña", href) +
    emailFallbackLink(href) +
    emailParagraph("<strong>Para empezar bien:</strong>", "margin-bottom:12px;") +
    emailSteps([
      ["Creá tu contraseña", "Con el botón de arriba."],
      ["Conectá tu Gmail", "Así el CRM registra tus correos y podés usar Secuencias."],
    ]) +
    emailCallout("info", "Por tu seguridad", "El enlace es personal y de un solo uso. Si caduca, pedile a un administrador que te envíe otra invitación.") +
    note("Si no esperabas esta invitación, podés ignorar este correo.");
  const html = renderEmail({
    subject,
    preheader: "Tu cuenta está lista. Creá tu contraseña para empezar.",
    eyebrow: "Invitación",
    title: "Te damos la bienvenida",
    bodyHtml,
    reason: "Recibís este correo porque un administrador te invitó a Avalith CRM con la dirección {{ .Email }}.",
    replies: false,
  });
  return { subject, html };
}
