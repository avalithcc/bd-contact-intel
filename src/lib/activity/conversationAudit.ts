/**
 * Pure decision behind the admin conversation bypass's audit write (task
 * 11.3; admin-access-audit spec "Admin conversation views are audit-logged"
 * and "No audit entry for own conversations"). `getConversationForAdmin`
 * (src/lib/activity/getConversationForAdmin.ts) calls this before writing
 * `audit_log(view_conversation)`.
 */
export function shouldAuditConversationView(actorBdId: string, targetBdId: string): boolean {
  return actorBdId !== targetBdId;
}
