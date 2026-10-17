/**
 * Sorts a database failure into three kinds, because they need three different answers:
 *  - connection or availability (isTransientDbError): the database is not there. Hold the sync cursor so the tick is
 *    retried once it is back. Recording is idempotent, so a retry is safe.
 *  - contention (isContentionDbError): a deadlock, lock timeout or statement timeout. Retry that one notification once
 *    in the same tick; if it fails again, skip it. These can recur on every tick, so they must never hold the cursor.
 *  - anything else: a data error. Skip the notification.
 * Conservative on purpose: anything not clearly recognised is "data", because a stuck cursor is worse than a lost bounce.
 */
// Exact SQLSTATEs only: 08P01 (protocol violation) and 53400 (configuration limit) are not outages and must not hold the cursor.
const TRANSIENT_SQLSTATES = new Set(["08000", "08001", "08003", "08004", "08006", "53100", "53200", "53300", "57P01", "57P02", "57P03"]);
const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "EMAXCONNSESSION"]);
const CONTENTION_SQLSTATES = new Set(["40P01", "55P03", "57014"]);

const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};

export function isTransientDbError(error: unknown): boolean {
  const code = codeOf(error);
  // Connection failures (08), resource exhaustion (53) and server shutdown (57P), by exact code.
  return code !== null && (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_SQLSTATES.has(code));
}

export function isContentionDbError(error: unknown): boolean {
  const code = codeOf(error);
  return code !== null && CONTENTION_SQLSTATES.has(code);
}
