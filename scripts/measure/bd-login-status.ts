/**
 * Read-only: why a BD cannot sign in. For every `bd` row it prints the matching `auth.users` row's state,
 * so the one who is locked out can be compared against the ones who are not.
 *
 * The CRM has ONE sign-in path: `supabase.auth.signInWithPassword` (src/app/(auth)/login/LoginForm.tsx).
 * There is no Google/OAuth sign-in; the only Google OAuth in the app connects a Gmail MAILBOX for sync
 * (src/app/api/gmail/oauth/start/route.ts) and it requires an existing session. So "cannot log in with the
 * Avalith Google account" is always one of: no bd row, no auth user, an email mismatch between the two, an
 * unconfirmed email (src/lib/queries.ts#getCurrentBd signs those out), a ban, or a deletion.
 *
 * Selects named columns only — never `select *` on `auth.users`, which holds the password hash and tokens
 * (README rule 3). Prints no secret: ids, dates and flags.
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; every read
 * here is sequential and issues no write.
 */
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";
import { isAllowedWorkEmail } from "@/lib/auth/allowedEmail";

type AuthRow = {
  id: string;
  email: string | null;
  providers: string | null;
  created_at: string | null;
  invited_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  deleted_at: string | null;
};

const day = (value: string | null) => (value ? new Date(value).toISOString().slice(0, 16).replace("T", " ") : "—");

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection)\n`);

  const bdRows = await db.select({ id: bd.id, name: bd.name, email: bd.email, role: bd.role }).from(bd).orderBy(asc(bd.name));

  const authRaw = await db.execute<AuthRow>(sql`
    select id::text as id,
           email,
           coalesce(raw_app_meta_data->>'providers', raw_app_meta_data->>'provider') as providers,
           created_at::text as created_at,
           invited_at::text as invited_at,
           email_confirmed_at::text as email_confirmed_at,
           last_sign_in_at::text as last_sign_in_at,
           banned_until::text as banned_until,
           deleted_at::text as deleted_at
    from auth.users
  `);
  const authByEmail = new Map([...authRaw].map((r) => [(r.email ?? "").trim().toLowerCase(), r]));

  for (const row of bdRows) {
    const key = (row.email ?? "").trim().toLowerCase();
    const auth = authByEmail.get(key);
    console.log(`${row.name}  <${row.email ?? "sin email"}>  role=${row.role ?? "-"}`);
    if (!isAllowedWorkEmail(row.email)) {
      console.log(`  BLOQUEA: el email no pasa isAllowedWorkEmail (debe ser exactamente @avalith.net)`);
    }
    if (!auth) {
      console.log(`  BLOQUEA: no hay fila en auth.users con ese email -> nunca fue invitado, o fue invitado a otra dirección`);
      console.log("");
      continue;
    }
    const problems: string[] = [];
    if (!auth.email_confirmed_at) problems.push("email SIN confirmar (getCurrentBd lo desloguea y manda a /login?error=not_authorized)");
    if (auth.banned_until) problems.push(`baneado hasta ${day(auth.banned_until)}`);
    if (auth.deleted_at) problems.push(`borrado el ${day(auth.deleted_at)}`);
    if (auth.email !== row.email) problems.push(`casing distinto entre bd ("${row.email}") y auth ("${auth.email}")`);
    console.log(
      `  auth: creado ${day(auth.created_at)} | invitado ${day(auth.invited_at)} | confirmado ${day(auth.email_confirmed_at)} | último login ${day(auth.last_sign_in_at)} | providers ${auth.providers ?? "—"}`,
    );
    console.log(problems.length === 0 ? "  puede loguearse" : `  BLOQUEA: ${problems.join("; ")}`);
    console.log("");
  }

  const orphanAuth = [...authRaw].filter((r) => !bdRows.some((b) => (b.email ?? "").trim().toLowerCase() === (r.email ?? "").trim().toLowerCase()));
  console.log(`filas de auth.users sin bd: ${orphanAuth.length}${orphanAuth.length ? ` -> ${orphanAuth.map((r) => r.email).join(", ")}` : ""}`);
  process.exit(0);
}

void main();
