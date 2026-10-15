/**
 * Dev-time safety net: `next dev` must never talk to production.
 *
 * `.env` / `.env.local` hold production values on the owner's machine, and
 * Next loads them in dev. `npm run dev` (scripts/dev.ts) overrides them with
 * the local stack; this guard is the second layer, for anyone who starts
 * `next dev` some other way. It only judges NODE_ENV=development, so production
 * builds, Vercel and scripts run with `vercel env run -e production` are never
 * affected.
 *
 * Pure and dependency free: it is imported from src/instrumentation.ts and
 * src/db/index.ts. Messages name variables, never print their values.
 */

type Env = Record<string, string | undefined>;

export const REMOTE_DB_OPT_OUT = "ALLOW_REMOTE_DB_IN_DEV";

/**
 * The dotenv files `next dev` loads, first match wins. By the time the guard
 * runs Next has already copied their values into process.env, so a value can no
 * longer be told apart from one typed in the shell. The guard therefore reads
 * these files itself (localDevCheck.ts) to find out where the opt-out came from.
 */
export const DEV_DOTENV_FILES = [".env.development.local", ".env.local", ".env.development", ".env"] as const;

/**
 * True when any parsed dotenv file turns the opt-out on. Such a value is not
 * honoured: a `.env` committed or copied into place must not be able to
 * quietly point local development at a remote database. If the shell also
 * sets it, the two are indistinguishable, so that is refused too (fail closed).
 */
export function dotenvEnablesOptOut(files: ReadonlyArray<Env>): boolean {
  return files.some((file) => file[REMOTE_DB_OPT_OUT]?.trim() === "1");
}

/** Variables whose host must be loopback while developing. */
export const GUARDED_URL_VARS = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for a parsable URL whose host is loopback. Unparsable counts as remote. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

/** Names of the guarded variables that are set and not loopback. Empty = safe. */
export function remoteDevTargets(env: Env, optOutFromDotenv = false): string[] {
  if (env.NODE_ENV !== "development") return [];
  if (env[REMOTE_DB_OPT_OUT]?.trim() === "1" && !optOutFromDotenv) return [];
  return GUARDED_URL_VARS.filter((name) => {
    const value = env[name]?.trim();
    return value ? !isLoopbackUrl(value) : false;
  });
}

/** Throws when a dev server would reach a non-loopback database or Supabase project. */
export function assertLocalDevTargets(env: Env = process.env, optOutFromDotenv = false): void {
  const remote = remoteDevTargets(env, optOutFromDotenv);
  if (remote.length === 0) return;
  const optOutHint =
    optOutFromDotenv && env[REMOTE_DB_OPT_OUT]?.trim() === "1"
      ? `${REMOTE_DB_OPT_OUT} is set in a dotenv file, which does not count; remove it from the file and type it in the shell instead: ${REMOTE_DB_OPT_OUT}=1 npx next dev.`
      : `To really use a remote target, type ${REMOTE_DB_OPT_OUT}=1 in the shell for that run (a dotenv file cannot enable it).`;
  throw new Error(
    `Refusing to start: ${remote.join(" and ")} point${remote.length === 1 ? "s" : ""} at a non-loopback host in development ` +
      `(likely production values from .env.local). Run \`npm run dev\`, which uses the local stack ` +
      `(see README, "Local development"). ${optOutHint}`,
  );
}
