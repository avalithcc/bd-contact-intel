/**
 * CLI equivalent of the messages.csv upload in the app (see
 * src/app/actions.ts#uploadMessagesCsv), for files too large for the
 * server-action body limit or for re-running an import without going
 * through the browser.
 *
 * Parses the file (src/lib/messagesCsv.ts), then delegates to the same
 * `importMessages` used by the app — same chunking, same
 * `ON CONFLICT DO NOTHING` idempotency on (bd_id, content_hash), same bulk
 * recompute of conversation/contact signals. Safe to re-run on the same
 * file or a newer export for the same BD.
 *
 * Usage (do NOT run automatically — this touches the real database):
 *   npx tsx scripts/import-messages.ts <bdEmail> <path-to-messages.csv>
 *
 * Requires DATABASE_URL to be set (see .env). Run AFTER
 * drizzle/0004_message_signals.sql has been migrated.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { bd } from "../src/db/schema";
import { parseMessagesCsv } from "../src/lib/messagesCsv";
import { importMessages } from "../src/lib/queries";

async function main() {
  const [bdEmail, filePath] = process.argv.slice(2);
  if (!bdEmail || !filePath) {
    console.error("Usage: npx tsx scripts/import-messages.ts <bdEmail> <path-to-messages.csv>");
    process.exit(1);
  }

  const me = await db.query.bd.findFirst({ where: eq(bd.email, bdEmail) });
  if (!me) {
    console.error(`No BD found with email ${bdEmail}`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseMessagesCsv(raw);
  const confidencePct =
    parsed.ownProfileConfidence != null ? `${Math.round(parsed.ownProfileConfidence * 100)}%` : "n/a";
  console.log(
    `Parsed ${parsed.rowCount} rows, ${parsed.conversations.length} conversations, ` +
      `detected own slug: ${parsed.ownProfileKey ?? "(none)"} (confidence ${confidencePct})`,
  );
  if (parsed.ownProfileWarning) {
    console.warn(`\n[WARNING] ${parsed.ownProfileWarning}\n`);
  }

  const { conversations, messages } = await importMessages(me.id, parsed);
  console.log(`Imported ${messages} messages across ${conversations} conversations for ${me.email}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
