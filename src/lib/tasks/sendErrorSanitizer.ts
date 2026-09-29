/**
 * Sanitizes a send failure before it's written to `task_digest_send.error`
 * (idempotency rule: "Record send failures ... error text without secrets").
 * Nodemailer's SMTP errors can echo back the server's response line, which —
 * on an AUTH LOGIN failure — sometimes includes the base64-encoded
 * SMTP_USER/SMTP_PASSWORD exchange. This strips anything that looks like a
 * credential and caps the length so one oversized error can't bloat the row.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // "Basic ..."/"Bearer ..." auth headers.
  /\b(Basic|Bearer)\s+[A-Za-z0-9+/=]+/gi,
  // Any other long base64-looking blob (crude but conservative — an SMTP
  // AUTH LOGIN credential looks exactly like this, and legitimate SMTP error
  // text is prose, not base64).
  /\b[A-Za-z0-9+/]{20,}={0,2}\b/g,
];

const MAX_LENGTH = 500;

export function sanitizeSendError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let sanitized = raw;
  for (const pattern of CREDENTIAL_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  return sanitized.length > MAX_LENGTH ? sanitized.slice(0, MAX_LENGTH) : sanitized;
}
