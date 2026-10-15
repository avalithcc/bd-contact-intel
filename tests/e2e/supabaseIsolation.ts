/**
 * What the e2e app server may receive, and which Supabase project the run may
 * log in to.
 *
 * The e2e server used to inherit everything in `.env.local` and override one
 * variable (DATABASE_URL), so the Supabase URL and anon key, and any secret
 * added later (OAuth client secret, Gmail token key, SMTP), reached the test
 * server silently. This inverts it: the server receives an explicit allowlist
 * and every other variable that Next would load from a dotenv file is blanked.
 *
 * Next never overrides a variable that is already defined in the server's
 * process environment, EVEN WITH AN EMPTY VALUE (@next/env processEnv keeps
 * the initial env), so setting a key to "" is a reliable way to stop a dotenv
 * file from filling it. Blanking is derived from the dotenv files' own keys,
 * so a secret added tomorrow is covered without touching this file.
 *
 * "Production" cannot be recognised by value without committing a project ref
 * to git. So the rule fails closed the other way round: a Supabase project is
 * only used silently when the owner NAMES it for the e2e run
 * (E2E_SUPABASE_URL + E2E_SUPABASE_ANON_KEY) and it differs from the one the
 * app is normally configured with. Anything else is the shared project and
 * needs the E2E_ALLOW_SHARED_SUPABASE=1 hatch, set in the shell for that run.
 *
 * Pure, no Playwright imports: tests/unit/e2eSupabaseIsolation.test.ts.
 */

type Env = Record<string, string | undefined>;

export const SHARED_SUPABASE_HATCH = 'E2E_ALLOW_SHARED_SUPABASE';

/**
 * The only variables the e2e app server is given a value for. The last one is
 * the local-development guard's opt-out (src/lib/dev/localDevGuard.ts): the
 * server this config starts is `next dev`, which refuses a non-loopback
 * Supabase URL, yet a throwaway hosted project or the acknowledged shared one
 * is a legitimate target here. It is set in the server's real process env, the
 * only place the guard honours, and DATABASE_URL is always a scratch database.
 */
export const SERVER_ENV_ALLOWLIST = [
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'ALLOW_REMOTE_DB_IN_DEV',
] as const;

/** dotenv precedence of `next dev`: the first file that defines a key wins. */
export const DOTENV_FILES_BY_PRECEDENCE = [
  '.env.development.local',
  '.env.local',
  '.env.development',
  '.env',
] as const;

/**
 * The dotenv file for scratch e2e runs: the settings that only make sense
 * against a throwaway stack (local Supabase URL, anon key, test credentials).
 * It is gitignored (`.env*`) and read only when DATABASE_URL is a scratch
 * database, so a read-only run against the dev server on :3000 never meets
 * E2E_SUPABASE_URL (which resolveSupabase refuses there).
 */
export const SCRATCH_DOTENV_FILE = '.env.e2e.local';

/** Dotenv files for this run, first wins. Returns a new array every call. */
export function dotenvFilesFor(scratch: boolean): string[] {
  return scratch ? [SCRATCH_DOTENV_FILE, ...DOTENV_FILES_BY_PRECEDENCE] : [...DOTENV_FILES_BY_PRECEDENCE];
}

/** True only for a loopback Supabase URL (the local `supabase start` stack). */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  try {
    const host = new URL((url ?? '').trim()).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Merge parsed dotenv files given in precedence order (first wins). */
export function mergeDotenv(filesByPrecedence: Array<Env>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of filesByPrecedence) {
    for (const [k, v] of Object.entries(file)) if (v !== undefined && !(k in merged)) merged[k] = v;
  }
  return merged;
}

/**
 * Keys of a dotenv file the TEST process may load: E2E_* settings only. The
 * hatch is excluded on purpose, it must be typed in the shell for each run and
 * can never be left behind in a file.
 */
export function testProcessDotenv(dotenv: Record<string, string>, env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dotenv)) {
    if (k.startsWith('E2E_') && k !== SHARED_SUPABASE_HATCH && env[k] === undefined) out[k] = v;
  }
  return out;
}

export interface SupabaseInput {
  /** E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY: the project named for the e2e run. */
  e2eUrl?: string;
  e2eAnonKey?: string;
  /** NEXT_PUBLIC_SUPABASE_* as the app is normally configured (shell, then dotenv). */
  appUrl?: string;
  appAnonKey?: string;
  /** E2E_ALLOW_SHARED_SUPABASE as typed in the shell. */
  hatch?: string;
  /** False when the suite reuses a server it did not start (read-only mode). */
  serverIsOurs: boolean;
}

export interface SupabaseResolution {
  target: { url: string; anonKey: string; shared: boolean } | null;
  refusal: string | null;
  /** Printed on every run that uses the shared project. */
  notice: string | null;
}

function sameProject(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      return new URL(s.trim()).origin.toLowerCase();
    } catch {
      return s.trim().replace(/\/+$/, '').toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

const clean = (s: string | undefined) => (s ?? '').trim();

function refuse(message: string): SupabaseResolution {
  return { target: null, refusal: message, notice: null };
}

/**
 * Decide which Supabase project the e2e run uses. Never puts a URL or key in a
 * message: variables are referred to by name.
 */
export function resolveSupabase(input: SupabaseInput): SupabaseResolution {
  const e2eUrl = clean(input.e2eUrl);
  const e2eKey = clean(input.e2eAnonKey);
  const appUrl = clean(input.appUrl);
  const appKey = clean(input.appAnonKey);

  if (e2eUrl) {
    if (!e2eKey) {
      return refuse('E2E_SUPABASE_URL is set but E2E_SUPABASE_ANON_KEY is not. Set both, or neither.');
    }
    if (!input.serverIsOurs) {
      return refuse(
        'E2E_SUPABASE_URL only applies to a server the suite starts itself (a scratch DATABASE_URL, ' +
          'see tests/e2e/README.md). Read-only mode reuses the dev server on :3000, which keeps the ' +
          'Supabase project from its own .env.local, so the setting would be a lie.',
      );
    }
    if (!appUrl || !sameProject(e2eUrl, appUrl)) {
      return { target: { url: e2eUrl, anonKey: e2eKey, shared: false }, refusal: null, notice: null };
    }
    // E2E_SUPABASE_URL names the very project the app is configured with: shared.
  }

  const url = e2eUrl || appUrl;
  const anonKey = e2eUrl ? e2eKey : appKey;
  if (!url || !anonKey) {
    return refuse(
      'No Supabase project is configured for the e2e run (NEXT_PUBLIC_SUPABASE_URL / ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY, or E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY).',
    );
  }
  if (input.hatch?.trim() !== '1') {
    return refuse(
      'Refusing to run: the e2e login would go through the SHARED Supabase project (the one in ' +
        '.env.local, i.e. production auth). A test run can lock out, rate-limit or otherwise touch ' +
        'real auth users. The repository cannot tell which project is production, so anything not ' +
        'explicitly named for e2e counts as shared. Either:\n' +
        '  - point the run at a throwaway project: set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY ' +
        '(different from NEXT_PUBLIC_SUPABASE_URL), or\n' +
        `  - acknowledge the shared project for this run only: ${SHARED_SUPABASE_HATCH}=1 in the ` +
        'shell (it is ignored in dotenv files).\n' +
        'Details: tests/e2e/README.md.',
    );
  }
  return {
    target: { url, anonKey, shared: true },
    refusal: null,
    notice:
      `${SHARED_SUPABASE_HATCH}=1: this run logs in through the SHARED Supabase project ` +
      '(real auth users, real rate limits). Use E2E_SUPABASE_URL for a throwaway one.',
  };
}

/**
 * The complete env override for the e2e dev server. Every dotenv key that is
 * not allowlisted is blanked, the allowlist gets its explicit values. Does not
 * mutate its inputs.
 */
export function buildServerEnv(input: {
  databaseUrl: string;
  supabase: { url: string; anonKey: string };
  dotenvKeys: readonly string[];
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of input.dotenvKeys) env[key] = '';
  env.DATABASE_URL = input.databaseUrl;
  env.NEXT_PUBLIC_SUPABASE_URL = input.supabase.url;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = input.supabase.anonKey;
  env.ALLOW_REMOTE_DB_IN_DEV = '1';
  return env;
}

export interface IsolatedServerInput extends SupabaseInput {
  /** Names the caller in messages: "e2e", "launch-readiness". */
  label: string;
  /** The scratch database for a server this run starts. Undefined: no server is ours. */
  databaseUrl: string | undefined;
  /** Every key defined in the dotenv files Next would load; all but the allowlist get blanked. */
  dotenvKeys: readonly string[];
}

export interface IsolatedServerPlan {
  /** Null when refused, or when this run starts no server of its own. */
  serverEnv: Record<string, string> | null;
  refusal: string | null;
  notice: string | null;
}

/**
 * The single entry point both Playwright configs use: judge the Supabase
 * project, then build the explicit server env. Neither config carries its own
 * copy of these rules. A refusal is meant to be thrown at config load.
 */
export function planIsolatedServer(input: IsolatedServerInput): IsolatedServerPlan {
  const { label, databaseUrl, dotenvKeys, ...supabaseInput } = input;
  const supabase = resolveSupabase(supabaseInput);
  if (supabase.refusal) return { serverEnv: null, refusal: `[${label}] ${supabase.refusal}`, notice: null };
  const notice = supabase.notice ? `[${label}] WARNING ${supabase.notice}` : null;
  if (!databaseUrl || !supabase.target) return { serverEnv: null, refusal: null, notice };
  return {
    serverEnv: buildServerEnv({ databaseUrl, supabase: supabase.target, dotenvKeys }),
    refusal: null,
    notice,
  };
}

/**
 * The launch-readiness pass keeps its scratch DATABASE_URL in `.env.e2e.local`
 * (the shell wins). Only that one non-E2E_ key may come from that file, and
 * assertScratchDatabaseUrl still judges the result.
 */
export function scratchDatabaseUrlFromFile(scratchFile: Env, env: Env): Record<string, string> {
  const fromFile = scratchFile.DATABASE_URL;
  return !env.DATABASE_URL && fromFile ? { DATABASE_URL: fromFile } : {};
}
