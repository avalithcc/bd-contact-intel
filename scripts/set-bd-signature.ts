/**
 * Owner-run: set another BD's email signature from a file. The app only lets a BD edit their OWN signature
 * (/account/signature → saveOwnSignature), which is right; this exists for the case the owner hit on
 * 2026-10-28 — Emmanuel had no signature stored, a mail had to go out from his mailbox that afternoon, and he
 * was at an event with no time to open the CRM. The owner asked for it and said Emmanuel had agreed.
 *
 * HONEST AUDIT. src/lib/signature/audit.ts assumes the actor and the target are the same BD, because a BD
 * only ever edits their own. Here they are NOT: the row is written with `actor_bd_id` = whoever ran this and
 * `target_bd_id` = the BD whose signature changed, so the log says "X changed Y's signature" instead of
 * pretending Y did it. Same action name and same metadata (lengths plus the sha256 of what was stored), so it
 * sits beside the real ones in the audit table.
 *
 * The HTML goes through the app's own `sanitizeSignatureHtml`, the same filter the save action uses, and the
 * stored value is the sanitized one — never the raw file.
 *
 * Dry run is the default. Usage:
 *   npx tsx --env-file=.env scripts/set-bd-signature.ts --bd=<email> --file=<path>
 *   …same line plus --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments or a write that did not happen.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, bd } from "../src/db/schema";
import { buildSignatureAuditRow } from "../src/lib/signature/audit";
import { prepareSignatureForSave } from "../src/lib/signature/validate";

function parseArgs(argv: readonly string[]) {
  const o = { target: null as string | null, file: null as string | null, actor: null as string | null, execute: false };
  for (const a of argv) {
    if (a === "--execute") o.execute = true;
    else if (a.startsWith("--bd=")) o.target = a.slice("--bd=".length).trim().toLowerCase();
    else if (a.startsWith("--file=")) o.file = a.slice("--file=".length);
    else if (a.startsWith("--actor=")) o.actor = a.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${a}. Valid: --bd=<email>, --file=<path>, --execute, --actor=<bd id>`);
  }
  if (!o.target) throw new Error("--bd=<email> is required.");
  if (!o.file) throw new Error("--file=<path> is required.");
  if (o.execute && !o.actor) throw new Error("--execute requires --actor=<bd id>: the audit row records who did it.");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  const targets = await db
    .select({ id: bd.id, name: bd.name, email: bd.email, signatureHtml: bd.signatureHtml })
    .from(bd)
    .where(sql`lower(${bd.email}) = ${o.target}`)
    .limit(2);
  if (targets.length > 1) throw new Error(`${o.target} matches ${targets.length} bd rows; refusing to guess whose signature to change.`);
  const target = targets[0];
  if (!target) throw new Error(`no bd row with email ${o.target}`);

  // The app's own validator, not a private copy of the rule: it enforces the input and output size caps that
  // /account/signature enforces, and reports a file that sanitizes to nothing instead of silently clearing.
  const raw = readFileSync(o.file!, "utf8");
  const prepared = prepareSignatureForSave(raw);
  if (!prepared.ok) throw new Error(`${o.file} is not a usable signature: ${prepared.error}`);
  if (prepared.html === null) throw new Error(`${o.file} is blank. This script sets a signature; it does not clear one.`);
  const sanitized = prepared.html;

  const before = target.signatureHtml;
  console.log(`BD:       ${target.name} <${target.email}>`);
  console.log(`antes:    ${before?.trim() ? `${before.length} caracteres` : "sin firma"}`);
  console.log(`archivo:  ${raw.length} caracteres | después de sanitizar: ${sanitized.length}`);
  if (sanitized !== raw.trim() && sanitized !== raw) console.log("OJO: el sanitizador cambió el HTML; lo que se guarda es la versión sanitizada de abajo.");
  console.log(`\n--- se guardaría ---\n${sanitized}\n--- fin ---\n`);

  if (!o.execute) {
    console.log("DRY RUN. No se escribió nada.");
    process.exit(0);
  }

  const [actorRow] = await db.select({ id: bd.id, name: bd.name }).from(bd).where(eq(bd.id, o.actor!));
  if (!actorRow) throw new Error(`--actor=${o.actor} does not match any bd row.`);

  await db.transaction(async (tx) => {
    await tx.update(bd).set({ signatureHtml: sanitized }).where(eq(bd.id, target.id));
    // Built for the target so the metadata and the hash match the app's own rows, then re-pointed at the real
    // actor: this was not a BD editing their own signature.
    const row = buildSignatureAuditRow({ actorBdId: target.id, before, after: sanitized });
    await tx.insert(auditLog).values({
      ...row,
      actorBdId: actorRow.id,
      targetBdId: target.id,
      // `via` tells the row apart from a BD editing their own signature in /account/signature, which is the
      // only other thing that writes this action.
      metadata: { ...row.metadata, via: "scripts/set-bd-signature.ts" },
    });
  });
  console.log(`guardada. audit_log: ${actorRow.name} cambió la firma de ${target.name}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
