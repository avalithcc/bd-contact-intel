/**
 * SMTP transport for the task-reminders digest (HostGator mailbox
 * `notificaciones@avalith.net`, same account already verified for
 * Supabase's password-reset email — see src/lib/auth/passwordReset.ts's
 * doc comment). Port 465 is implicit TLS (`secure: true`) — do NOT set
 * `secure: false` with port 465, that pattern is for STARTTLS on 587.
 *
 * This module is intentionally the ONLY place `nodemailer.createTransport`
 * is called, and the ONLY place anything actually sends mail — every other
 * module here (digest.ts, digestQueries.ts, the route's dry-run path)
 * builds content or reads/writes rows without touching SMTP. Never import
 * this from a test or from a script's default (non-`--execute`-equivalent)
 * path.
 */
import nodemailer from "nodemailer";

/** The digest's sending mailbox — also shown in the footer (src/lib/tasks/digest.ts) so the two never drift apart. */
export const DIGEST_FROM_ADDRESS = "notificaciones@avalith.net";

export interface DigestSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The sending mailbox cannot receive mail, so a message that expects an answer sets where replies go. */
  replyTo?: string[];
}

/** Header values must be one line: CR/LF in a subject (e.g. a BD name) would let data inject headers. */
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function buildTransport() {
  return nodemailer.createTransport({
    host: requiredEnv("SMTP_HOST"),
    port: Number(requiredEnv("SMTP_PORT")),
    secure: true,
    auth: {
      user: requiredEnv("SMTP_USER"),
      pass: requiredEnv("SMTP_PASSWORD"),
    },
  });
}

/** Sends one digest email. Throws on any SMTP failure — the caller catches, sanitizes, and records it on the claim row. */
export async function sendDigestEmail(input: DigestSendInput): Promise<void> {
  const transport = buildTransport();
  await transport.sendMail({
    from: `"Avalith CRM" <${DIGEST_FROM_ADDRESS}>`,
    to: input.to,
    subject: singleLine(input.subject),
    html: input.html,
    text: input.text,
    ...(input.replyTo?.length ? { replyTo: input.replyTo } : {}),
  });
}
