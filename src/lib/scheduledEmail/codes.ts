/**
 * Failure codes of a scheduled email that held files or several recipients and could not be sent as scheduled. Every one means
 * "provably not sent": the row is 'failed' with the code, the BD gets a task that says why, and nothing goes out with a
 * recipient or a file missing. Pure, so the dispatcher's classification and the sender share one spelling.
 */
/** No service-role key on the server (or it was removed after the email was scheduled). */
export const ATTACHMENTS_UNAVAILABLE = "attachments_unavailable";
/** A file is missing, belongs to someone else or no longer passes the policy. */
export const ATTACHMENT_FAILED = "attachment_failed";
/** One of the "Para" recipients opted out (email_suppression) since the email was scheduled. */
export const RECIPIENT_SUPPRESSED = "recipient_suppressed";

export const NOT_SENT_CODES: readonly string[] = [ATTACHMENTS_UNAVAILABLE, ATTACHMENT_FAILED, RECIPIENT_SUPPRESSED];
