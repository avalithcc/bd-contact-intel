/**
 * DB glue for the send path (imports `@/db`, so — same convention as
 * syncQueries.ts — not unit-tested directly; the ordering and conflict logic
 * lives in storeSentEmail.ts / sentMessage.ts and is tested there).
 *
 * After a successful Gmail send, ONE transaction commits the `email_sent`
 * activity together with the `email_message` row, its `email_message_person`
 * link rows, and the activity's `metadata.emailMessageId` pointer — so the
 * conversation view has the message the moment the send returns instead of
 * after the next Gmail sync.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailMessage, emailMessagePerson, type NewActivity } from "@/db/schema";
import { createActivityInTx } from "@/lib/activity/queries";
import { extractEmailAddresses, shouldStoreClassifiedMessage, type ClassifiedMessage } from "./classify";
import { getKnownPersonsForAddresses } from "./syncQueries";
import { getNeverLogRules } from "./neverLog";
import { classifySentMessage, type SentMessageInput } from "./sentMessage";
import { storeSentEmailMessage, type SentEmailStore } from "./storeSentEmail";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function txStore(tx: DbTransaction): SentEmailStore {
  return {
    async insertMessage(row) {
      const [inserted] = await tx.insert(emailMessage).values(row).onConflictDoNothing().returning({ id: emailMessage.id });
      return inserted?.id ?? null;
    },
    async findMessageId(bdId, gmailMessageId) {
      const [existing] = await tx
        .select({ id: emailMessage.id })
        .from(emailMessage)
        .where(and(eq(emailMessage.bdId, bdId), eq(emailMessage.gmailMessageId, gmailMessageId)));
      return existing!.id;
    },
    async insertPersonLinks(rows) {
      await tx.insert(emailMessagePerson).values(rows).onConflictDoNothing();
    },
  };
}

/** Same matching inputs the sync uses (CRM persons for exactly these addresses, this BD's never-log rules). Null = nothing to store. */
async function classifyForStorage(
  bdId: string,
  input: Omit<SentMessageInput, "now">,
): Promise<ClassifiedMessage | null> {
  const knownPersons = await getKnownPersonsForAddresses(extractEmailAddresses(input.to));
  if (knownPersons.length === 0) return null;
  const neverLogRules = await getNeverLogRules(bdId);
  const classified = classifySentMessage({ ...input, now: new Date(), knownPersons, neverLogRules });
  return shouldStoreClassifiedMessage(classified) ? classified : null;
}

export interface RecordSentEmailInput {
  bdId: string;
  message: Omit<SentMessageInput, "now">;
  activity: NewActivity;
}

/**
 * The row is an optimisation, the activity is the record: if anything about
 * the row fails (classification read, insert), fall back to the activity-only
 * write the app did before — the send already happened and must not lose its
 * activity.
 */
export async function recordSentEmail(input: RecordSentEmailInput): Promise<void> {
  let classified: ClassifiedMessage | null = null;
  try {
    classified = await classifyForStorage(input.bdId, input.message);
  } catch (error) {
    console.error("sent-mail row skipped (classification failed); the sync will write it", error);
  }

  if (classified) {
    try {
      await db.transaction(async (tx) => {
        const stored = await storeSentEmailMessage(txStore(tx), input.bdId, classified!);
        await createActivityInTx(tx, {
          ...input.activity,
          metadata: { ...(input.activity.metadata as Record<string, unknown>), emailMessageId: stored.emailMessageId },
        });
      });
      return;
    } catch (error) {
      console.error("sent-mail row + activity transaction failed; retrying activity only", error);
    }
  }

  await db.transaction((tx) => createActivityInTx(tx, input.activity));
}
