/**
 * Where an email attachment lives in Supabase Storage. Pure and free of server-only imports, so the browser (which uploads
 * straight to the bucket with the user's own session, see UploadForm.tsx for the pattern) and the server share it.
 *
 * `<auth uid>/<uuid>/<ascii file name>`: the first folder is the uploader's auth user id, which is what the bucket's RLS
 * policies key on (scripts/sql/email-attachments-bucket.sql) and what the server re-checks on every path it receives.
 */
export const EMAIL_ATTACHMENTS_BUCKET = "email-attachments";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHAPE = new RegExp(`^(${UUID})/(${UUID})/([A-Za-z0-9._-]{1,120})$`, "i");

export function buildAttachmentPath(authUid: string, uploadId: string, safeName: string): string {
  return `${authUid}/${uploadId}/${safeName}`;
}

/** The auth user a path belongs to, or null when the path is not exactly `<uid>/<uuid>/<name>`. */
export function pathOwner(path: string): string | null {
  const m = SHAPE.exec(path);
  if (!m) return null;
  const name = m[3]!;
  if (name === "." || name === "..") return null;
  return m[1]!.toLowerCase();
}

/** True only for a well-formed path inside the caller's own folder (a tampered path never matches). */
export function pathBelongsTo(path: string, authUid: string): boolean {
  const owner = pathOwner(path);
  return owner !== null && owner === authUid.toLowerCase();
}
