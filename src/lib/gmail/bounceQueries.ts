/**
 * DB side of bounce detection. `recordBounces` takes the notifications one BD's sync parsed (parseBounce.ts) and, in ONE
 * transaction, applies what bouncePlan.ts allows:
 *
 *  - hard: person.email_status = 'bounced' (+ history row), an address suppression with source 'bounce', every live
 *    Sequence membership of the address discarded with reason 'bounce', its pending scheduled sends cancelled, and one
 *    `email_bounced` timeline entry per Contact holding the address, naming those effects;
 *  - soft: the timeline entry only.
 *
 * Idempotent: a notification is recorded once per address (the entry carries `dsnGmailMessageId`; bounceKey is the one
 * key builder), the suppression insert is ON CONFLICT DO NOTHING and the status/discard writes are guarded on their
 * previous value. The BD's advisory lock serializes two overlapping syncs so the duplicate check cannot race.
 *
 * Revert (no audit row on purpose, see the brief): for the person ids in the `email_bounced` entries,
 *   update person set email_status = '<person_property_history.old_value>' where id = ...; delete the
 *   email_suppression row (source = 'bounce'); re-admit the members (discard_reason = 'bounce') by hand.
 * Write volume is bounded: at most MAX_BOUNCES_PER_RUN notifications per sync tick.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, emailMessage, emailSuppression, person, personPropertyHistory, sequence, sequenceMember } from "@/db/schema";
import { cancelPendingForAddress } from "@/lib/scheduledEmail/queries";
import { canTransition, MEMBER_STATES, type MemberState } from "@/lib/sequences/memberState";
import { bounceKey, buildBounceMetadata, planBounces, type BounceEffects, type OutboundCandidate } from "./bouncePlan";
import type { ParsedBounce } from "./parseBounce";

export const MAX_BOUNCES_PER_RUN = 50;
export const BOUNCE_ACTIVITY_TYPE = "email_bounced";
export const BOUNCE_HISTORY_SOURCE = "bounce";
export const BOUNCE_DISCARD_REASON = "bounce";

export interface RecordBouncesResult {
  hard: number;
  soft: number;
  unlinked: number;
  duplicates: number;
  scheduledCancelled: number;
  membersDiscarded: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const asAddresses = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()) : [];

/** This BD's own outbound mail that the notifications point at (by thread or Message-ID). */
async function readOutbound(bdId: string, batch: readonly ParsedBounce[]): Promise<OutboundCandidate[]> {
  const threads = [...new Set(batch.map((b) => b.gmailThreadId))];
  const rfcIds = [...new Set(batch.flatMap((b) => b.linkRfcIds))];
  const rows = await db
    .select({ thread: emailMessage.gmailThreadId, rfc: emailMessage.rfcMessageId, subject: emailMessage.subject, to: emailMessage.toAddresses, cc: emailMessage.ccAddresses })
    .from(emailMessage)
    .where(and(eq(emailMessage.bdId, bdId), eq(emailMessage.direction, "outbound"), or(inArray(emailMessage.gmailThreadId, threads), rfcIds.length ? inArray(emailMessage.rfcMessageId, rfcIds) : undefined)));
  return rows.map((r) => ({ gmailThreadId: r.thread, rfcMessageId: r.rfc, subject: r.subject, recipients: [...asAddresses(r.to), ...asAddresses(r.cc)] }));
}

async function readRecorded(tx: Tx, batch: readonly ParsedBounce[]): Promise<Set<string>> {
  const dsn = sql<string>`${activity.metadata}->>'dsnGmailMessageId'`;
  const rows = await tx
    .select({ dsn, address: sql<string>`${activity.metadata}->>'address'` })
    .from(activity)
    .where(and(eq(activity.type, BOUNCE_ACTIVITY_TYPE), inArray(dsn, batch.map((b) => b.dsnGmailMessageId))));
  return new Set(rows.map((r) => bounceKey(r.dsn, r.address)));
}

export async function recordBounces(bdId: string, bounces: readonly ParsedBounce[]): Promise<RecordBouncesResult> {
  const result: RecordBouncesResult = { hard: 0, soft: 0, unlinked: 0, duplicates: 0, scheduledCancelled: 0, membersDiscarded: 0 };
  const batch = bounces.slice(0, MAX_BOUNCES_PER_RUN);
  if (batch.length === 0) return result;
  const outbound = await readOutbound(bdId, batch);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`bounce:${bdId}`}, 0))`);
    const plan = planBounces(batch, outbound, await readRecorded(tx, batch));
    result.unlinked = plan.unlinked;
    result.duplicates = plan.duplicates;
    if (plan.events.length === 0) return result;

    const addresses = [...new Set(plan.events.map((e) => e.address))];
    const holders = await tx
      .select({ id: person.id, address: person.emailNormalized, status: person.emailStatus })
      .from(person)
      .where(and(inArray(person.emailNormalized, addresses), isNull(person.mergedIntoId)));
    const hardAddresses = [...new Set(plan.events.filter((e) => e.severity === "hard").map((e) => e.address))];
    const effects = await applyHard(tx, bdId, hardAddresses, holders);
    result.scheduledCancelled = [...effects.values()].reduce((sum, e) => sum + e.scheduledCancelled, 0);
    result.membersDiscarded = [...effects.values()].reduce((sum, e) => sum + e.discarded, 0);

    // The entry names what THIS run did: the first notification for an address carries the effects, a later one none.
    const reported = new Set<string>();
    const entries = plan.events.flatMap((event) =>
      holders
        .filter((h) => h.address === event.address)
        .map((h) => ({ personId: h.id, type: BOUNCE_ACTIVITY_TYPE, actorBdId: bdId, metadata: buildBounceMetadata(event, event.severity === "hard" && !reported.has(event.address) ? effects.get(event.address) : undefined) })),
    );
    for (const event of plan.events) if (event.severity === "hard") reported.add(event.address);
    if (entries.length > 0) await tx.insert(activity).values(entries);
    for (const event of plan.events) result[event.severity] += 1;
    return result;
  });
}

async function applyHard(tx: Tx, bdId: string, addresses: string[], holders: { id: string; address: string | null; status: string }[]): Promise<Map<string, BounceEffects>> {
  const effects = new Map<string, BounceEffects>(addresses.map((a) => [a, { sequenceNames: [], scheduledCancelled: 0, discarded: 0 }]));
  if (addresses.length === 0) return effects;

  const toMark = holders.filter((h) => h.address && addresses.includes(h.address) && h.status !== "bounced");
  if (toMark.length > 0) {
    await tx.update(person).set({ emailStatus: "bounced", updatedAt: sql`now()` }).where(and(inArray(person.id, toMark.map((h) => h.id)), ne(person.emailStatus, "bounced")));
    await tx.insert(personPropertyHistory).values(toMark.map((h) => ({ personId: h.id, property: "emailStatus", oldValue: h.status, newValue: "bounced", changedByBdId: null, source: BOUNCE_HISTORY_SOURCE })));
  }

  await tx
    .insert(emailSuppression)
    .values(addresses.map((address) => ({ kind: "address", value: address, source: "bounce", recordedByBdId: bdId, personId: holders.find((h) => h.address === address)?.id ?? null })))
    .onConflictDoNothing();

  // Bounded loop (at most MAX_BOUNCES_PER_RUN addresses, normally one): the existing per-address cancel is reused as is.
  for (const address of addresses) effects.get(address)!.scheduledCancelled = await cancelPendingForAddress(tx, address);

  const live = await tx
    .select({ id: sequenceMember.id, state: sequenceMember.state, address: person.emailNormalized, sequenceName: sequence.name })
    .from(sequenceMember)
    .innerJoin(person, eq(person.id, sequenceMember.personId))
    .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
    .where(and(inArray(person.emailNormalized, addresses), ne(sequenceMember.state, "discarded")));
  const discardable = live.filter((m) => (MEMBER_STATES as readonly string[]).includes(m.state) && canTransition(m.state as MemberState, "discarded", "bounce"));
  if (discardable.length > 0) {
    await tx
      .update(sequenceMember)
      .set({ state: "discarded", discardReason: BOUNCE_DISCARD_REASON, discardedByBdId: null, discardedAt: sql`now()` })
      .where(and(inArray(sequenceMember.id, discardable.map((m) => m.id)), ne(sequenceMember.state, "discarded")));
    for (const m of discardable) {
      const e = effects.get(m.address ?? "");
      if (!e) continue;
      e.discarded += 1;
      if (!e.sequenceNames.includes(m.sequenceName)) e.sequenceNames.push(m.sequenceName);
    }
  }
  return effects;
}
