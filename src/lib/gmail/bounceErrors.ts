/**
 * Tells an outage (retry later) from a data error (retrying cannot help). Only an outage may hold the sync cursor.
 * Conservative on purpose: anything it does not clearly recognise as a connection-class failure counts as data, because
 * a stuck cursor is worse than a lost bounce.
 */
const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "EMAXCONNSESSION"]);

export function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  // SQLSTATE class 08 (connection exception), 53 (insufficient resources), 57P (operator intervention / shutdown).
  return TRANSIENT_NODE_CODES.has(code) || /^(08|53|57P)/.test(code);
}
