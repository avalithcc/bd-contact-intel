/**
 * Pure exit-code decision for scripts/reset-bd-password.ts's `--execute`
 * path — see that file's header comment for the full contract:
 *   0 = password reset AND the audit_log row was written
 *   1 = nothing changed (every failure before or during the admin API
 *       call — argument errors, unresolved target, bad --actor, missing env
 *       vars, the admin API call itself failing — uses the ordinary thrown-
 *       error path and needs no dedicated helper)
 *   2 = the password WAS changed via the Supabase admin API, but the
 *       audit_log insert failed afterward — never exit 0 here, the operator
 *       must know the write is out of sync with the audit trail
 */
export function passwordResetExitCode(auditWritten: boolean): 0 | 2 {
  return auditWritten ? 0 : 2;
}
