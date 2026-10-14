/**
 * DB layer for the unsubscribe flow. Nothing under src/app imports it until PR 13 mounts the route.
 * Uses the app's Drizzle/postgres client (never supabase-js: RLS is on with no policies and would block it).
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppression, person, sequenceMember, sequenceUnsubscribeToken } from "@/db/schema";
import { OPT_OUT_DISCARD_REASON, planOptOutDiscards } from "@/lib/sequences/optOut";
import { normalizeSuppressionValue } from "@/lib/sequences/suppression";
import type { UnsubscribePort } from "@/lib/sequences/unsubscribeHandlers";
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

/**
 * The single suppression write, in ONE transaction: insert the suppression (ON CONFLICT DO NOTHING), stamp used_at
 * if still null, and discard every live membership of the address with reason opt_out and a null actor. A repeat
 * call changes nothing. Returns null when no token matches.
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
      .insert(emailSuppression)
      .values({
        kind: "address",
        value: token.email,
        source: "unsubscribe_link",
        recordedByBdId: null,
        personId: token.personId,
        sequenceMemberId: token.memberId,
      })
      .onConflictDoNothing();

    await tx
      .update(sequenceUnsubscribeToken)
      .set({ usedAt: sql`now()` })
      .where(and(eq(sequenceUnsubscribeToken.tokenHash, tokenHash), isNull(sequenceUnsubscribeToken.usedAt)));

    const live = await tx
      .select({ id: sequenceMember.id, state: sequenceMember.state })
      .from(sequenceMember)
      .innerJoin(person, eq(person.id, sequenceMember.personId))
      .where(
        and(
          // email_normalized may be null on older rows, so fall back to normalizing the raw column.
          or(eq(person.emailNormalized, token.email), sql`lower(trim(${person.email})) = ${token.email}`),
          ne(sequenceMember.state, "discarded"),
        ),
      );
    const toDiscard = planOptOutDiscards(live);
    if (toDiscard.length > 0) {
      await tx
        .update(sequenceMember)
        .set({
          state: "discarded",
          discardReason: OPT_OUT_DISCARD_REASON,
          discardedByBdId: null,
          discardedAt: sql`now()`,
        })
        .where(and(inArray(sequenceMember.id, toDiscard), ne(sequenceMember.state, "discarded")));
    }
    return { email: token.email };
  });
}

/** The port the route handlers (PR 13) will be given. */
export const unsubscribePort: UnsubscribePort = { findToken: findTokenByHash, suppressByToken };
