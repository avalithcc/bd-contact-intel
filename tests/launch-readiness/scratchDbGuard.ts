/**
 * The launch-readiness pass WRITES (calls, meetings, tasks, discards) and the
 * app has no delete path, so anything it writes to production stays there
 * forever. Every entry point of the pass (seed script, Playwright config,
 * each spec) calls this first and refuses to continue unless DATABASE_URL is
 * a local database whose name ends in `_e2e`.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertScratchDatabaseUrl(url: string | undefined): void {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("DATABASE_URL is missing or unparsable; the launch-readiness pass needs a scratch database");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to run: ${parsed.hostname} is not a local host`);
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_e2e")) {
    throw new Error(`Refusing to run: database "${dbName}" does not end in _e2e`);
  }
}
