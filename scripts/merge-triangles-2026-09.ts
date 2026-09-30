/**
 * One-off: collapse three confirmed duplicate TRIANGLES that
 * scripts/merge-duplicates.ts deliberately refuses to touch.
 *
 * Each of these is 3 person rows with all 3 pairs open in
 * duplicate_candidate. The bulk CLI skips any pair whose person appears in
 * another open pair (`findChainedPersonIds`), because it will not guess a
 * merge order. A closed triangle means every pair is confirmed, so the order
 * is not a guess here — but it IS load-bearing, which is why this is a
 * separate, explicit script rather than a loosened rule in the CLI.
 *
 * Survivor choice (owner-confirmed 2026-09-30, by which address is correct):
 *
 *   Corubolo  diego.corubolo@redwood.com   (diego.corulo@ is a typo)
 *   Bencomo   bj@mercately.com             (bjohnmer@gmail.com is personal)
 *   Blanco    jorge.blanco@nubiral.com     (jorge@ is the short form)
 *
 * Why the survivor is sometimes the row WITHOUT an email: `profileKey` is not
 * in merge.ts's TRACKED_FIELDS, so a merge never copies it onto the survivor.
 * For Corubolo and Bencomo the profile_key (and, for Corubolo, a LinkedIn
 * conversation) sits on the email-less row, so that row survives and inherits
 * the email instead — `mergeEmailFields` gives the address to whichever side
 * has one when the other does not. Blanco's email-less row has no
 * profile_key, so there the correct-email row survives directly.
 *
 * Order is load-bearing: the CORRECT address must be merged in first, so the
 * survivor holds it before the second address arrives. Both addresses are
 * `verified`, so the second merge is a rank tie, and `mergeEmailFields`
 * breaks ties in favour of the survivor. Reversed, the survivor would keep
 * the typo and record the good address as the PropertyLoss.
 *
 * Dry run by default. Writing needs --execute --actor=<bd id>.
 * Each step is a normal mergeContacts call, so each writes a merge_event and
 * is undone by unmergeContact from /admin/duplicates.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { person } from "@/db/schema";
import { mergeContacts } from "@/lib/identity/mergeDb";

interface Triangle {
  label: string;
  survivorId: string;
  /** Merged in this order. The correct address MUST come first. */
  mergeInOrder: readonly string[];
  /** Asserted on the survivor after every merge of this triangle. */
  expectedEmail: string;
}

const TRIANGLES: readonly Triangle[] = [
  {
    label: "Diego Corubolo",
    survivorId: "31f1a679-caaf-45ef-8feb-11f4bf11f578", // profile_key + 1 conversation
    mergeInOrder: [
      "2ceda58b-1cee-4a4c-aa55-105fc5b7ed8c", // diego.corubolo@redwood.com — correct
      "b5e77af6-f731-4ff3-b7de-dac5b4ef8553", // diego.corulo@redwood.com — typo
    ],
    expectedEmail: "diego.corubolo@redwood.com",
  },
  {
    label: "Johnmer Bencomo",
    survivorId: "1a104759-0dc8-4c01-91b3-eb285e9350df", // profile_key
    mergeInOrder: [
      "c849f717-6b79-41ca-9b61-56bb40b5e878", // bj@mercately.com — correct
      "310e9b1a-aac4-4de1-ac0c-2a7936094f62", // bjohnmer@gmail.com — personal
    ],
    expectedEmail: "bj@mercately.com",
  },
  {
    label: "Jorge Blanco",
    survivorId: "c8936de2-0c23-4598-8bac-e36f014182b6", // jorge.blanco@nubiral.com — correct
    mergeInOrder: [
      "8f397823-74a8-49c3-8cdb-e1eb116af1de", // jorge@nubiral.com — short form
      "55f48f20-cee4-46de-b2d1-223d26eb88b6", // no email, no profile_key
    ],
    expectedEmail: "jorge.blanco@nubiral.com",
  },
];

const REASON = "confirmed_triangle_2026_09";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actorBdId: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actorBdId = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (execute && !actorBdId) throw new Error("--execute needs --actor=<bd id>");
  return { execute, actorBdId };
}

async function main(): Promise<void> {
  const { execute, actorBdId } = parseArgs(process.argv.slice(2));

  // Refuse to run against anything but the expected starting state: every row
  // still present, none already merged away.
  const allIds = TRIANGLES.flatMap((t) => [t.survivorId, ...t.mergeInOrder]);
  const rows = await db
    .select({ id: person.id, email: person.email, mergedIntoId: person.mergedIntoId })
    .from(person)
    .where(inArray(person.id, allIds));

  if (rows.length !== allIds.length) {
    throw new Error(`Expected ${allIds.length} person rows, found ${rows.length} — refusing to run.`);
  }
  const alreadyMerged = rows.filter((r) => r.mergedIntoId !== null);
  if (alreadyMerged.length) {
    throw new Error(
      `Refusing to run: ${alreadyMerged.length} row(s) already merged away (${alreadyMerged
        .map((r) => r.id)
        .join(", ")}). This script is not idempotent by design — re-check the queue.`,
    );
  }

  for (const t of TRIANGLES) {
    console.log(`\n${t.label} — survivor ${t.survivorId}`);
    for (const mergedId of t.mergeInOrder) {
      const from = rows.find((r) => r.id === mergedId)!;
      if (!execute) {
        console.log(`  WOULD MERGE ${mergedId} <${from.email ?? "—"}> into the survivor`);
        continue;
      }
      const { mergeEventId } = await mergeContacts(db, t.survivorId, mergedId, REASON, actorBdId as string);
      console.log(`  merged ${mergedId} <${from.email ?? "—"}> mergeEventId=${mergeEventId}`);
    }

    if (!execute) {
      console.log(`  survivor should end with <${t.expectedEmail}>`);
      continue;
    }

    const [after] = await db
      .select({ email: person.email, profileKey: person.profileKey })
      .from(person)
      .where(eq(person.id, t.survivorId));
    const ok = after?.email === t.expectedEmail;
    console.log(
      `  survivor now <${after?.email ?? "—"}> profile_key=${after?.profileKey ? "kept" : "none"} — ${
        ok ? "as expected" : "MISMATCH"
      }`,
    );
    if (!ok) {
      throw new Error(
        `${t.label}: survivor email is ${after?.email ?? "null"}, expected ${t.expectedEmail}. ` +
          `Stopping before the remaining triangles. Undo with unmergeContact from /admin/duplicates.`,
      );
    }
  }

  console.log(execute ? "\nDone." : "\nDry run only — pass --execute --actor=<bd id> to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
