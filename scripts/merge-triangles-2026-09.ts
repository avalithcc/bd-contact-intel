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

/**
 * Named batches. A batch is run once; the guard below refuses to re-run one,
 * because these definitions are specific person ids, not a query.
 */
const BATCHES: Record<string, readonly Triangle[]> = {
  // Run 2026-09-30. Owner confirmed each correct address by hand.
  "a": [
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
  ],
  // Run 2026-09-30, second batch. These five are the `classic_split_no_conflict`
  // bucket of the open queue: one side is a HubSpot import row carrying the
  // email, another is a LinkedIn row carrying the profile_key and the owner,
  // and a third has only a job title. The bulk CLI reports them as `safe` but
  // then skips every one as a transitive chain, because each person also
  // appears in the triangle's other two pairs.
  //
  // Survivor is the profile_key side in all five, per the rule established
  // with batch "a": profileKey is not in TRACKED_FIELDS so a merge never
  // copies it onto the survivor, while email IS tracked and moves to whichever
  // side has one. Only one row per triangle has an email here, so there is no
  // rank tie to break — the order below just keeps the convention.
  "b": [
    {
      label: "Alan Brande",
      survivorId: "787a3a8f-9598-48d5-ab05-efaa3ff6cd4f", // profile_key + owner
      mergeInOrder: [
        "c7c6d8b9-a013-4b99-8abf-b645660a5bdf", // alanbrande@lightit.com.uy
        "dd6913cc-0762-44a4-99dd-8e66429dc206", // title only
      ],
      expectedEmail: "alanbrande@lightit.com.uy",
    },
    {
      label: "Ewan Begue",
      survivorId: "ec7f7cf9-7cd9-4872-9357-dc75fa5544ca",
      mergeInOrder: [
        "978637f6-f7fa-4c42-9e37-09488f49be91", // ebegue@zafirus.tech
        "6708662e-0adb-4d76-b77b-7d015d06a6c1", // title only
      ],
      expectedEmail: "ebegue@zafirus.tech",
    },
    {
      label: "Andres Gonzalez",
      survivorId: "719db294-65e7-47b8-b6c8-b2f2ca7027fb",
      mergeInOrder: [
        "8e3b9abf-aefe-4c8f-a2c9-f25598d7ccbd", // andres@aulasneo.com
        "ef15207b-c251-4169-a09e-2e1f0525cd67", // title only
      ],
      expectedEmail: "andres@aulasneo.com",
    },
    {
      label: "Diego Revello",
      survivorId: "c0f81d9d-cee1-4ddd-9665-560c8c9d351c",
      mergeInOrder: [
        "71af83bb-8f79-4359-8691-fed290a85758", // diego.revello@bancogalicia.com.ar
        "9a56792a-ae9e-4fd2-89fb-a84741b582b3", // title only
      ],
      expectedEmail: "diego.revello@bancogalicia.com.ar",
    },
    {
      label: "Matias Mutchinick",
      survivorId: "d41b4c24-c8f4-4bd2-910b-778ebda6da10",
      mergeInOrder: [
        "a9659ea5-fe01-4859-8ab7-f0690530c884", // matias.m@wizeline.com
        "9398b203-f7d8-4c94-86c8-fede02c41890", // title only
      ],
      expectedEmail: "matias.m@wizeline.com",
    },
  ],
};

const REASON = "confirmed_triangle_2026_09";

function parseArgs(argv: readonly string[]) {
  let execute = false;
  let actorBdId: string | null = null;
  let batch: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actorBdId = arg.slice("--actor=".length);
    else if (arg.startsWith("--batch=")) batch = arg.slice("--batch=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!batch) throw new Error(`--batch=<name> is required. Known batches: ${Object.keys(BATCHES).join(", ")}`);
  if (!(batch in BATCHES)) throw new Error(`Unknown batch "${batch}". Known: ${Object.keys(BATCHES).join(", ")}`);
  if (execute && !actorBdId) throw new Error("--execute needs --actor=<bd id>");
  return { execute, actorBdId, triangles: BATCHES[batch], batch };
}

async function main(): Promise<void> {
  const { execute, actorBdId, triangles, batch } = parseArgs(process.argv.slice(2));
  console.log(`batch ${batch}: ${triangles.length} triangle(s)`);

  // Refuse to run against anything but the expected starting state: every row
  // still present, none already merged away.
  const allIds = triangles.flatMap((t) => [t.survivorId, ...t.mergeInOrder]);
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

  for (const t of triangles) {
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
