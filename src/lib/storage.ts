/**
 * Supabase Storage bucket used for staging LinkedIn `messages.csv` exports
 * before they're parsed and imported (see src/app/actions.ts#uploadMessagesCsv).
 * Server actions can't accept a ~6.5MB file body directly on Vercel (request
 * bodies are capped around 4.5MB regardless of Next.js's own
 * `serverActions.bodySizeLimit`), so the browser uploads straight to this
 * bucket with the user's own session, and the server action only receives
 * the resulting storage path.
 *
 * Requires one-time manual setup in the Supabase dashboard — see README.md
 * for the bucket creation + RLS policy SQL.
 *
 * Shared between a client component (src/app/UploadForm.tsx) and a
 * server action (src/app/actions.ts), so it lives in its own plain module
 * rather than either of those files ("use server" files may only export
 * async functions).
 */
export const MESSAGES_IMPORT_BUCKET = "linkedin-imports";
