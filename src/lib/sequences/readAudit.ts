/**
 * Legacy audit action. Admins used to leave a `view_sequence` row when they opened another BD's Sequence; the owner
 * dropped that (2026-10-16: admin visibility is follow-up and is never audited), so NOTHING writes it any more. The
 * constant stays only so /admin/audit-log can still list and label the rows written before the change.
 */
export const SEQUENCE_READ_AUDIT_ACTION = "view_sequence";
