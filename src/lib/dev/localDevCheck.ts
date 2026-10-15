/**
 * Node-only entry point of the dev guard, used by src/db/index.ts and
 * src/instrumentation.ts. It lives apart from localDevGuard.ts so the pure
 * rules stay free of `node:fs` (the instrumentation hook also compiles for the
 * edge runtime).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { DEV_DOTENV_FILES, REMOTE_DB_OPT_OUT, assertLocalDevTargets, dotenvEnablesOptOut } from "./localDevGuard";

/**
 * Parse the dev dotenv files under `root`; a missing file is an empty object.
 * A file that exists but cannot be read (EACCES, a directory named `.env`)
 * throws the guard's own message instead of a raw stack trace, and never counts
 * as "no opt-out": the guard cannot vouch for what it cannot read, so it stops.
 */
export function readDevDotenvFiles(root: string): Array<Record<string, string | undefined>> {
  return DEV_DOTENV_FILES.map((name) => {
    const file = path.join(root, name);
    if (!existsSync(file)) return {};
    try {
      return parseEnv(readFileSync(file, "utf8"));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "unreadable";
      throw new Error(
        `Refusing to start: cannot read ${name} (${code}) to check where ${REMOTE_DB_OPT_OUT} comes from. ` +
          `Fix or remove that file; the dev guard stays closed while it cannot read the dotenv files.`,
      );
    }
  });
}

/** Judge the real process environment; reads files only when NODE_ENV=development. */
export function checkLocalDevTargets(root: string = process.cwd()): void {
  if (process.env.NODE_ENV !== "development") return;
  assertLocalDevTargets(process.env, dotenvEnablesOptOut(readDevDotenvFiles(root)));
}
