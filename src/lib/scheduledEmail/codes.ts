/**
 * Failure codes of a scheduled email that held files and could not send them. Both mean "provably not sent": the row is
 * 'failed' with the code, the BD gets a task, and nothing goes out without its files. Pure, so the dispatcher's
 * classification and the sender share one spelling.
 */
/** No service-role key on the server (or it was removed after the email was scheduled). */
export const ATTACHMENTS_UNAVAILABLE = "attachments_unavailable";
/** A file is missing, belongs to someone else or no longer passes the policy. */
export const ATTACHMENT_FAILED = "attachment_failed";

export const ATTACHMENT_FAILURE_CODES: readonly string[] = [ATTACHMENTS_UNAVAILABLE, ATTACHMENT_FAILED];
