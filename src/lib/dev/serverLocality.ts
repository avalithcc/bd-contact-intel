/**
 * Is the Postgres SERVER on this machine? Asked of the server, not the URL.
 *
 * `localhost:5432` proves nothing about the server: an SSH tunnel bound to
 * 5432 forwards to a remote Postgres, and `drop database` would run there.
 * `inet_server_addr()` is NULL on a unix-socket connection and otherwise the
 * address the server accepted the connection on; through a tunnel that is the
 * REMOTE host's address, never loopback.
 */

/** Query to run on the admin connection before any drop or create. */
export const SERVER_IDENTITY_QUERY =
  "select inet_server_addr()::text as addr, current_database() as db, version() as version";

export interface ServerIdentity {
  addr: string | null;
  db: string;
  version: string;
}

/** True for NULL (unix socket) and loopback addresses; anything else is a remote server. */
export function isLocalServerAddress(addr: string | null | undefined): boolean {
  if (addr === null) return true;
  if (typeof addr !== "string") return false; // fail closed on an unexpected shape
  const host = addr.trim().replace(/\/(32|128)$/, "").toLowerCase();
  return host === "::1" || host === "::ffff:127.0.0.1" || /^127(\.\d{1,3}){3}$/.test(host);
}

/** Null when the server is local, otherwise the refusal message (names the tunnel scenario). */
export function serverLocalityRefusal(id: ServerIdentity): string | null {
  if (isLocalServerAddress(id.addr)) return null;
  return (
    `Refusing to drop or create databases: the server behind localhost:5432 is not on this machine ` +
    `(it answered from ${id.addr ?? "an unknown address"}). Loopback in the URL does not prove the server is local: ` +
    `an SSH tunnel bound to port 5432 forwards to a remote Postgres, and the drop would run there. ` +
    `Connected to database "${id.db}" on ${id.version}. Close the tunnel or free port 5432, then retry.`
  );
}
