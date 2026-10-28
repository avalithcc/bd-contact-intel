/**
 * Owner-run one-off send from a NAMED mailbox, for when the BD who owns it cannot sit down and press send.
 * Written 2026-10-28: the owner needed a handful of event emails to go out from emmanuel@avalith.net, with
 * Mariel in Cc to follow and answer them, while Emmanuel was at the event. The owner confirmed Emmanuel
 * agreed to it.
 *
 * WHY THIS IS NOT A BACK DOOR. It calls `sendGmailMessageFromAccount`, the entry point the Sequence runner
 * already uses: the account is loaded by its own `email_account.id` and the sender is that row's address,
 * never a literal. The `email_sent` activity it writes is credited to that account's own BD
 * (`actorBdId: account.bdId`), so the CRM records the send under the mailbox owner, which is the truth. What
 * the app's UI does not offer — the composer resolves the mailbox from the signed-in BD — is a UI rule, and
 * this script does not forge anything the record then has to lie about.
 *
 * REPLIES GO TO THE MAILBOX THAT SENT, not to the Cc. Pass `--reply-to=` to route answers to whoever is
 * actually going to handle them; without it, every reply lands in the sender's inbox.
 *
 * ONE EMAIL PER RUN, on purpose: no list, no loop, nothing to blast by accident.
 *
 * Dry run is the default and sends nothing. Usage:
 *   npx tsx --env-file=.env.local scripts/send-as-bd.ts --from=emmanuel@avalith.net \
 *     --to=someone@empresa.com --cc=mariel.meza@avalith.net --reply-to=mariel.meza@avalith.net \
 *     --subject="…" --body-file=/path/body.txt
 *   …same line plus --execute
 *
 * The body comes from a FILE, never from the command line: accents and line breaks do not survive shell
 * quoting, and a half-mangled email cannot be unsent.
 *
 * It refuses when `--to` is not a live contact in the CRM, so the send always lands on a record as an
 * `email_sent` activity (`--allow-unknown` overrides, and then nothing is logged against a person).
 *
 * EXIT CODES: 0 success (dry run or sent); 1 bad arguments, an unknown recipient, or a send failure.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { bd, emailAccount, person } from "../src/db/schema";
import { INTERNAL_CC_DOMAIN } from "../src/lib/email/recipients/cc";
import { assertRecipients } from "../src/lib/gmail/recipient";
import { sendGmailMessageFromAccount } from "../src/lib/gmail/send";
import { composeEmailBody } from "../src/lib/signature/compose";

function parseArgs(argv: readonly string[]) {
  const o = {
    from: null as string | null,
    to: null as string | null,
    cc: [] as string[],
    // Repeatable: RFC 5322 allows several addresses in Reply-To, and they travel as ONE header line built by
    // rawMessage.ts, which reserves `reply-to` so it can never also arrive as a raw extra header.
    replyTo: [] as string[],
    subject: null as string | null,
    bodyFile: null as string | null,
    execute: false,
    allowUnknown: false,
  };
  for (const a of argv) {
    if (a === "--execute") o.execute = true;
    else if (a === "--allow-unknown") o.allowUnknown = true;
    else if (a.startsWith("--from=")) o.from = a.slice("--from=".length).trim().toLowerCase();
    else if (a.startsWith("--to=")) o.to = a.slice("--to=".length).trim();
    else if (a.startsWith("--cc=")) o.cc.push(a.slice("--cc=".length).trim());
    else if (a.startsWith("--reply-to=")) o.replyTo.push(a.slice("--reply-to=".length).trim());
    else if (a.startsWith("--subject=")) o.subject = a.slice("--subject=".length);
    else if (a.startsWith("--body-file=")) o.bodyFile = a.slice("--body-file=".length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  for (const [name, value] of [["--from", o.from], ["--to", o.to], ["--subject", o.subject], ["--body-file", o.bodyFile]] as const) {
    if (!value) throw new Error(`${name} is required.`);
  }
  // Validated HERE so a typo fails on the dry run, not after the token refresh (a network call that can
  // write email_account.status). Cc and Reply-To are held to the internal domain, the same product rule the
  // composer applies to Cc (src/lib/email/recipients/cc.ts): this script routes a colleague's mail inside the
  // team, and an external Reply-To would send a prospect's answer where nobody here can read it.
  assertRecipients(o.to!);
  for (const [flag, list] of [["--cc", o.cc], ["--reply-to", o.replyTo]] as const) {
    for (const address of list) {
      assertRecipients(address);
      if (address.slice(address.lastIndexOf("@") + 1).toLowerCase() !== INTERNAL_CC_DOMAIN) {
        throw new Error(`${flag}=${address} is not on @${INTERNAL_CC_DOMAIN}; this script only copies colleagues.`);
      }
    }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  const accounts = await db
    .select({
      id: emailAccount.id,
      address: emailAccount.emailAddress,
      status: emailAccount.status,
      bdId: emailAccount.bdId,
      // The sender's own stored signature, so this script composes the message the way the app does
      // (src/lib/signature/compose.ts): plain text when there is none, HTML with the block when there is.
      signatureHtml: bd.signatureHtml,
    })
    .from(emailAccount)
    .innerJoin(bd, sql`${bd.id} = ${emailAccount.bdId}`)
    .where(sql`lower(${emailAccount.emailAddress}) = ${o.from}`)
    .limit(2);
  if (accounts.length > 1) throw new Error(`${o.from} matches ${accounts.length} email_account rows; refusing to guess which mailbox sends.`);
  const account = accounts[0];
  if (!account) throw new Error(`no connected mailbox for ${o.from}. Its owner has to connect it at /account/email first.`);
  if (account.status !== "connected") throw new Error(`the mailbox ${account.address} is '${account.status}', not 'connected'. Its owner has to reconnect it.`);

  // An address can sit on SEVERAL person rows once a merge has happened: the survivor plus the row that was
  // merged away, which keeps its email. Take the LIVE one; `order by merged_into_id nulls first` makes that
  // deterministic instead of leaving it to whatever the planner returns first, which refused a perfectly
  // sendable contact on the first run of this script.
  const matches = await db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, company: person.company, mergedIntoId: person.mergedIntoId })
    .from(person)
    .where(sql`lower(coalesce(${person.emailNormalized}, ${person.email})) = ${o.to!.toLowerCase()}`)
    .orderBy(sql`${person.mergedIntoId} nulls first`);
  const live = matches.filter((m) => m.mergedIntoId === null);
  const recipient = live[0];
  if (matches.length > 1) {
    console.log(`(${matches.length} filas con esa dirección: ${matches.length - live.length} fusionada(s) y ${live.length} viva(s).)`);
  }
  // Two LIVE rows sharing an address is an open duplicate, and picking one would hang the email_sent activity
  // on a coin flip. Refuse and let a human merge them first.
  if (live.length > 1) {
    throw new Error(`${o.to} is on ${live.length} live contacts (${live.map((m) => m.id).join(", ")}); merge them in /admin/duplicates before sending.`);
  }
  if (!recipient && matches.length > 0) {
    throw new Error(`every contact row for ${o.to} has been merged away; open the surviving record and use its address.`);
  }
  if (!recipient && !o.allowUnknown) {
    throw new Error(`${o.to} is not a contact in the CRM, so this send would be logged against nobody. Create the contact, or pass --allow-unknown.`);
  }

  const body = readFileSync(o.bodyFile!, "utf8");
  if (body.trim().length === 0) throw new Error(`${o.bodyFile} is empty.`);

  const replyToLine = o.replyTo.join(", ");
  const who = recipient ? `${[recipient.firstName, recipient.lastName].filter(Boolean).join(" ")} (${recipient.company ?? "sin empresa"})` : "(no es contacto del CRM)";

  console.log(`De:        ${account.address}`);
  console.log(`Para:      ${o.to}  -> ${who}`);
  console.log(`CC:        ${o.cc.length ? o.cc.join(", ") : "(ninguno)"}`);
  console.log(`Reply-To:  ${replyToLine || "(ninguno: las respuestas van a " + account.address + ")"}`);
  console.log(`Asunto:    ${o.subject}`);
  console.log(`Actividad: ${recipient ? `email_sent en el contacto, acreditada al dueño de la casilla` : "ninguna"}`);
  const content = composeEmailBody(body, account.signatureHtml);
  console.log(`Firma:     ${account.signatureHtml?.trim() ? `sí, la de ${account.address} (${account.signatureHtml.length} car.) — el mensaje sale como HTML` : "NO TIENE: el mensaje sale en texto plano, sin firma"}`);
  console.log(`\n--- cuerpo (${body.length} caracteres) ---\n${body}\n--- fin ---\n`);

  if (!o.execute) {
    console.log("DRY RUN. No se envió nada. Agregá --execute para mandarlo.");
    process.exit(0);
  }

  // A failure AFTER the Gmail call would otherwise read as "nothing happened" and invite a second send to an
  // outside contact. src/lib/gmail/send.ts no longer throws past the send (its cache revalidation is
  // best-effort now), and this says so out loud for anything that still could.
  let result: Awaited<ReturnType<typeof sendGmailMessageFromAccount>>;
  try {
    result = await sendGmailMessageFromAccount({
    accountId: account.id,
    to: o.to!,
    subject: o.subject!,
    ...content,
    cc: o.cc.length ? o.cc : undefined,
      replyTo: o.replyTo.length ? o.replyTo : undefined,
      personId: recipient?.id,
    });
  } catch (err) {
    console.error(
      `FALLÓ: ${err instanceof Error ? err.message : String(err)}\n` +
        `ANTES DE REINTENTAR, mirá la carpeta Enviados de ${account.address}: si el mensaje está ahí, salió y un reintento lo manda dos veces.`,
    );
    process.exit(1);
  }
  console.log(`ENVIADO. ${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
