/**
 * Regenerates supabase/email-templates/{recovery,invite}.html and subjects.json from the shared email layout.
 * Paste the HTML and subject into the Supabase dashboard (Authentication > Email Templates); nothing here calls Supabase.
 *
 * Usage: npx tsx scripts/build-supabase-email-templates.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildInviteTemplate, buildRecoveryTemplate } from "../src/lib/mailer/supabaseTemplates";

const dir = join(process.cwd(), "supabase", "email-templates");
mkdirSync(dir, { recursive: true });
const recovery = buildRecoveryTemplate();
const invite = buildInviteTemplate();
writeFileSync(join(dir, "recovery.html"), `${recovery.html}\n`);
writeFileSync(join(dir, "invite.html"), `${invite.html}\n`);
writeFileSync(join(dir, "subjects.json"), `${JSON.stringify({ recovery: recovery.subject, invite: invite.subject }, null, 2)}\n`);
console.log(`wrote ${dir}/{recovery.html,invite.html,subjects.json}`);
