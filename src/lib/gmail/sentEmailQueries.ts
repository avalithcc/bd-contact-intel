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
import { activity, emailMessage, emailMessagePerson, type NewActivity } from "@/db/schema";
import { recomputePersonStatuses } from "@/lib/status/recompute";
import { isOwnerTouchType } from "@/lib/identity/ownerOnTouch";
import { transferOwnersOnTouch } from "@/lib/identity/ownerOnTouchDb";
import { createActivityInTx } from "@/lib/activity/queries";
import { extractEmailAddresses, shouldStoreClassifiedMessage, type ClassifiedMessage } from "./classify";
import { getKnownPersonsForAddresses } from "./syncQueries";
import { getNeverLogRules } from "./neverLog";
import { classifySentMessage, type SentMessageInput } from "./sentMessage";
import { shouldWriteSentActivity, storeSentEmailMessage, type SentEmailStore } from "./storeSentEmail";

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
  /**
   * Other contacts the SAME message went to ("Para" with several contacts): each gets its own copy of `activity` on its
   * record, all pointing at the one `email_message`, so every one of them moves to "Contactado" like a single send.
   */
  alsoRecordFor?: readonly string[];
}

/** The primary activity first, then one copy per additional contact (no legacy lead/company link on the copies). */
function activitiesOf(input: RecordSentEmailInput): NewActivity[] {
  const copies = [...new Set(input.alsoRecordFor ?? [])]
    .filter((personId) => personId !== input.activity.personId)
    .map((personId) => ({ ...input.activity, personId, leadId: undefined, companyKey: undefined }) as NewActivity);
  return [input.activity, ...copies];
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
        const toWrite = activitiesOf(input)
          .filter((act) => shouldWriteSentActivity(stored, classified!.matches, act.personId))
          .map((act) => ({ ...act, metadata: { ...(act.metadata as Record<string, unknown>), emailMessageId: stored.emailMessageId } }) as NewActivity);
        await insertActivities(tx, toWrite);
      });
      return;
    } catch (error) {
      console.error("sent-mail row + activity transaction failed; retrying activity only", error);
    }
  }

  await db.transaction((tx) => insertActivities(tx, activitiesOf(input)));
}

/**
 * ONE activity: exactly the write the app always did. Several (one per "Para" contact): one INSERT and one batched
 * status recompute for all of them, so a 20-contact email costs the same round trips as a 2-contact one.
 */
async function insertActivities(tx: DbTransaction, acts: NewActivity[]): Promise<void> {
  if (acts.length <= 1 || acts.some((a) => a.personId == null)) {
    for (const act of acts) await createActivityInTx(tx, act);
    return;
  }
  await tx.insert(activity).values(acts);
  await recomputePersonStatuses(tx, acts.map((a) => a.personId!));
  const touched = acts.filter((a) => isOwnerTouchType(a.type));
  if (touched.length) await transferOwnersOnTouch(tx, touched.map((a) => a.personId!), touched[0]!.actorBdId ?? null);
}
