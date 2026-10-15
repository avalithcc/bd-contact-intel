/**
 * Creates (or with --reset, recreates) the LOCAL development database and
 * fills it with demo data. Idempotent: a plain run only creates what is
 * missing and seeds only when EVERY table the seed truncates (and each table
 * CASCADE would also empty) holds no rows, so it never wipes your dev data.
 *
 *   npm run dev:setup    create DB if absent, migrate, ensure login user, seed if empty
 *   npm run dev:reset    drop the dev DB first, then the same
 *
 * Everything targets the hard-coded loopback URLs of src/lib/dev/localDevEnv.ts;
 * nothing here reads DATABASE_URL from the environment or any dotenv file, so
 * it cannot reach production. Prints counts only.
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import {
  LOCAL_DEV_DATABASE_URL,
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_URL,
} from "../src/lib/dev/localDevEnv";
import { isLoopbackUrl } from "../src/lib/dev/localDevGuard";
import { SERVER_IDENTITY_QUERY, serverLocalityRefusal, type ServerIdentity } from "../src/lib/dev/serverLocality";
import {
  SEED_TRUNCATED_TABLES,
  cascadeTablesQuery,
  missingSeedTables,
  occupiedTables,
  occupiedTablesQuery,
} from "../src/lib/dev/seedTables";

const DEV_EMAIL = "dev@avalith.net";
const DEV_PASSWORD = "dev-local-only-password";
const DB_NAME = "bd_contact_intel_dev";
const reset = process.argv.includes("--reset");

if (!isLoopbackUrl(LOCAL_DEV_DATABASE_URL) || !isLoopbackUrl(LOCAL_SUPABASE_URL)) {
  throw new Error("Local dev URLs are not loopback; refusing to continue.");
}

const childEnv = {
  ...process.env,
  DATABASE_URL: LOCAL_DEV_DATABASE_URL,
  E2E_SUPABASE_URL: LOCAL_SUPABASE_URL,
  E2E_SUPABASE_ANON_KEY: LOCAL_SUPABASE_ANON_KEY,
  E2E_EMAIL: DEV_EMAIL,
  E2E_PASSWORD: DEV_PASSWORD,
};

function run(label: string, cmd: string, args: string[]) {
  console.log(`[dev-setup] ${label}`);
  const r = spawnSync(cmd, args, { env: childEnv, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

async function main() {
  const admin = postgres("postgres://localhost:5432/postgres", { max: 1, onnotice: () => {} });
  try {
    // Ask the server, not the URL: a tunnel on :5432 would make the drop run remotely.
    const [identity] = await admin.unsafe(SERVER_IDENTITY_QUERY);
    const refusal = serverLocalityRefusal(identity as unknown as ServerIdentity);
    if (refusal) throw new Error(refusal);
    if (reset) {
      await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
      console.log(`[dev-setup] dropped ${DB_NAME}`);
    }
    const [exists] = await admin`select 1 as one from pg_database where datname = ${DB_NAME}`;
    if (!exists) {
      await admin.unsafe(`create database ${DB_NAME}`);
      console.log(`[dev-setup] created ${DB_NAME}`);
    }
  } finally {
    await admin.end();
  }

  run("migrating", "npx", ["drizzle-kit", "migrate"]);
  run("ensuring the local login user", "npx", ["tsx", "scripts/create-e2e-auth-user.ts", "--execute"]);

  const sql = postgres(LOCAL_DEV_DATABASE_URL, { max: 1, onnotice: () => {} });
  let checked: string[] = [];
  let occupied: string[] = [];
  try {
    checked = (await sql.unsafe(cascadeTablesQuery())).map((r) => String(r.name));
    const missing = missingSeedTables(checked);
    if (missing.length > 0) throw new Error(`Seed tables missing after migrating: ${missing.join(", ")}`);
    const [row] = await sql.unsafe(occupiedTablesQuery(checked));
    occupied = occupiedTables(checked, row ?? {});
  } finally {
    await sql.end();
  }
  console.log(`[dev-setup] emptiness check covers ${checked.length} tables: ${checked.join(", ")}`);

  if (occupied.length === 0) {
    run("seeding demo contacts", "npx", ["tsx", "scripts/seed-launch-readiness.ts", "--execute"]);
    run("seeding company categories", "npx", ["tsx", "scripts/seed-company-categories.ts", "scripts/fixtures/dev-company-categories.json"]);
    run("seeding target companies", "npx", ["tsx", "scripts/seed-target-companies.ts", "scripts/fixtures/dev-target-companies.json"]);
    const s2 = postgres(LOCAL_DEV_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await s2`update bd set name = 'Dev User' where email = ${DEV_EMAIL}`;
    } finally {
      await s2.end();
    }
  } else {
    console.log(`[dev-setup] data already present in ${occupied.join(", ")}, seed skipped (use npm run dev:reset to start over)`);
  }
  console.log(`[dev-setup] done. Login: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
}

main().catch((e) => {
  console.error(`[dev-setup] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
