/**
 * Writes every Avalith CRM email, filled with invented sample data, as a standalone .html file for a real-client
 * test (open in a browser or paste into a tester). Sends nothing and touches no database.
 *
 * Usage: npx tsx scripts/render-email-previews.ts <output-dir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOwnerNoticeEmail, buildReminderEmail } from "../src/lib/gmail/reminderEmail";
import { buildInviteTemplate, buildRecoveryTemplate, stripHtmlComments } from "../src/lib/mailer/supabaseTemplates";
import { buildDigestEmail } from "../src/lib/tasks/digest";

const out = process.argv[2];
if (!out) throw new Error("usage: render-email-previews.ts <output-dir>");
mkdirSync(out, { recursive: true });
const SITE = "https://bd-contact-intel.vercel.app";
const task = (id: string, title: string, day: string, personId: string, first: string, last: string, company: string) => ({
  id, title, dueAt: new Date(`${day}T00:00:00Z`), personId, companyKey: null,
  subjectPersonFirstName: first, subjectPersonLastName: last, subjectPersonCompany: company, subjectCompanyName: null,
});
const digest = buildDigestEmail(
  { name: "Valentina Rojas", email: "valentina.rojas@avalith.example" },
  {
    today: [task("1", "Enviar propuesta comercial", "2026-10-16", "c1", "Camila", "Soto", "Lumen Retail")],
    yesterday: [task("2", "Llamar para dar seguimiento", "2026-10-15", "c2", "Paula", "Ibarra", "Cobalto Seguros")],
    overdue: [task("3", "Compartir casos de éxito", "2026-10-12", "c3", "Tomás", "Quiroga", "Andes Fintech")],
  },
  SITE,
)!;
// Supabase strips HTML comments and substitutes its Go-template actions at send time; do the same with sample values here.
const fill = (html: string) =>
  stripHtmlComments(html).replaceAll("{{ .SiteURL }}", SITE).replaceAll("{{ .TokenHash }}", "7c1f9e0a").replaceAll("{{ .Email }}", "valentina.rojas@avalith.example");
const files: Record<string, string> = {
  "resumen-diario.html": digest.html,
  "recordatorio-gmail.html": buildReminderEmail({ name: "Joaquín Reyes" }, SITE).html,
  "aviso-administracion.html": buildOwnerNoticeEmail({ name: "Joaquín Reyes", email: "joaquin.reyes@avalith.example" }).html,
  "restablecer-contrasena.html": fill(buildRecoveryTemplate().html),
  "invitacion.html": fill(buildInviteTemplate().html),
};
for (const [name, html] of Object.entries(files)) writeFileSync(join(out, name), html);
console.log(`wrote ${Object.keys(files).length} files to ${out}`);
