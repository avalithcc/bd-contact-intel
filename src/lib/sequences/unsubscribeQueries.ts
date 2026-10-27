/**
 * DB layer for the unsubscribe flow. Used by src/app/api/unsubscribe/route.ts.
 * Uses the app's Drizzle/postgres client (never supabase-js: RLS is on with no policies and would block it).
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppression, person, sequenceMember, sequenceUnsubscribeToken } from "@/db/schema";
import { cancelPendingForAddress } from "@/lib/scheduledEmail/queries";
import { audienceFactsSql } from "@/lib/sequences/rosterQuery";
import { audienceInputsFromRow } from "@/lib/sequences/audienceInputs";
import { OPT_OUT_DISCARD_REASON, planOptOutDiscards } from "@/lib/sequences/optOut";
import { normalizeSuppressionValue } from "@/lib/sequences/suppression";
import type { UnsubscribePort } from "@/lib/sequences/unsubscribeHandlers";
import { pinToStep1 } from "@/lib/sequences/languageMismatch";
import { unsubscribePageAudience, type UnsubscribePageAudience } from "@/lib/sequences/unsubscribePageAudience";
import { generateUnsubscribeToken, hashUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

/** One indexed read on token_hash. Writes nothing. */
export async function findTokenByHash(tokenHash: string): Promise<{ email: string } | null> {
  const [row] = await db
    .select({ email: sequenceUnsubscribeToken.emailNormalized })
    .from(sequenceUnsubscribeToken)
    .where(eq(sequenceUnsubscribeToken.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

/**
 * Issues a NEW token for one send and returns the raw value: the only moment it exists in clear. Called once per
 * message (step 1, then again for the reminder), never reused, because only the hash is stored. The old link keeps
 * working for as long as its row exists.
 */
export async function issueUnsubscribeToken(input: { sequenceMemberId: string; email: string }): Promise<string> {
  const token = generateUnsubscribeToken();
  await db.insert(sequenceUnsubscribeToken).values({
    tokenHash: hashUnsubscribeToken(token),
    sequenceMemberId: input.sequenceMemberId,
    emailNormalized: normalizeSuppressionValue("address", input.email),
  });
  return token;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The shared half of every opt-out, run inside the caller's transaction: insert the address suppression (ON CONFLICT
 * DO NOTHING) and discard every live membership of that address with reason opt_out. Used by the unsubscribe link
 * (null actor) and by the BD's "No contactar" (optOutQueries.ts, actor = the BD) so both go through one rule. Returns
 * the memberships it discarded; a repeat returns none.
 */
export async function suppressAddressInTx(
  tx: Tx,
  input: { email: string; source: "unsubscribe_link" | "reply"; actorBdId: string | null; personId: string; sequenceMemberId: string },
): Promise<{ id: string; personId: string; sequenceId: string }[]> {
  await tx
    .insert(emailSuppression)
    .values({ kind: "address", value: input.email, source: input.source, recordedByBdId: input.actorBdId, personId: input.personId, sequenceMemberId: input.sequenceMemberId })
    .onConflictDoNothing();
  // An opted-out address must not receive a scheduled email either (same transaction as the suppression itself).
  await cancelPendingForAddress(tx, input.email);

  const live = await tx
    .select({ id: sequenceMember.id, state: sequenceMember.state, personId: sequenceMember.personId, sequenceId: sequenceMember.sequenceId })
    .from(sequenceMember)
    .innerJoin(person, eq(person.id, sequenceMember.personId))
    .where(
      and(
        // email_normalized may be null on older rows, so fall back to normalizing the raw column.
        or(eq(person.emailNormalized, input.email), sql`lower(trim(${person.email})) = ${input.email}`),
        ne(sequenceMember.state, "discarded"),
      ),
    );
  const ids = new Set(planOptOutDiscards(live));
  const toDiscard = live.filter((m) => ids.has(m.id));
  if (toDiscard.length > 0) {
    await tx
      .update(sequenceMember)
      .set({ state: "discarded", discardReason: OPT_OUT_DISCARD_REASON, discardedByBdId: input.actorBdId, discardedAt: sql`now()` })
      .where(and(inArray(sequenceMember.id, [...ids]), ne(sequenceMember.state, "discarded")));
  }
  return toDiscard;
}

/**
 * The unsubscribe link's write, in ONE transaction: suppression plus discards (suppressAddressInTx, null actor) and
 * the token stamp if still null. A repeat call changes nothing. Returns null when no token matches.
 */
export async function suppressByToken(tokenHash: string): Promise<{ email: string } | null> {
  return db.transaction(async (tx) => {
    const [token] = await tx
      .select({
        email: sequenceUnsubscribeToken.emailNormalized,
        memberId: sequenceUnsubscribeToken.sequenceMemberId,
        personId: sequenceMember.personId,
      })
      .from(sequenceUnsubscribeToken)
      .innerJoin(sequenceMember, eq(sequenceMember.id, sequenceUnsubscribeToken.sequenceMemberId))
      .where(eq(sequenceUnsubscribeToken.tokenHash, tokenHash))
      .limit(1);
    if (!token) return null;

    await tx
      .update(sequenceUnsubscribeToken)
      .set({ usedAt: sql`now()` })
      .where(and(eq(sequenceUnsubscribeToken.tokenHash, tokenHash), isNull(sequenceUnsubscribeToken.usedAt)));
    await suppressAddressInTx(tx, { email: token.email, source: "unsubscribe_link", actorBdId: null, personId: token.personId, sequenceMemberId: token.memberId });
    return { email: token.email };
  });
}

/**
 * What the unsubscribe page needs about the recipient: the postal address AND the language their own email carried, i.e.
 * their compliance audience (complianceAudience.ts) found from the token (person country, company country, postings, phone),
 * UNLESS a person recorded the draft's language on the member (sequence_member.draft_language) or on the contact
 * (person.preferred_language), which win for the language only: the address is always the audience's. Both come from the one statement below; unsubscribePageAudience decides. One
 * read, no writes: the GET path is typed read-only on purpose. Undefined for an unknown token or a contact with neither an
 * audience nor a chosen language: English and no address (never another country's). A chosen language with no audience
 * gives that language and no address.
 */
export async function unsubscribeAudienceForToken(tokenHash: string): Promise<UnsubscribePageAudience | undefined> {
  const rows = (await db.execute(sql`
    select sm.draft_language, p.preferred_language, ${audienceFactsSql},
           case when sm.sent_at is not null then (select d.language from sequence_draft d where d.sequence_member_id = sm.id and d.step = 1) end as step1_language
    from sequence_unsubscribe_token t
    join sequence_member sm on sm.id = t.sequence_member_id
    join person p on p.id = sm.person_id
    where t.token_hash = ${tokenHash}
    limit 1`)) as unknown as ({ draft_language: string | null; preferred_language: string | null; step1_language: string | null } & Record<string, unknown>)[];
  const row = rows[0];
  if (!row) return undefined;
  // Once step 1 went out, both of its links (step 1 and the reminder) are in step 1's language: the same pin the reminder is drafted with.
  return unsubscribePageAudience(audienceInputsFromRow(row), pinToStep1({ chosen: row.draft_language, preferred: row.preferred_language }, row.step1_language));
}

/** The port the unsubscribe route (PR 13) is given. */
export const unsubscribePort: UnsubscribePort = { findToken: findTokenByHash, suppressByToken };
