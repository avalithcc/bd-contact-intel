/**
 * "No contactar" (outreach-sequences task 10.8): a BD records an opt-out that arrived as a reply instead of through the
 * unsubscribe link. Reuses the link's transaction core (suppressAddressInTx), so the address is suppressed and every
 * live membership of it, in every Sequence and for every BD, is discarded with reason opt_out. The actor is the BD, and
 * each discarded membership gets an audit row in the same transaction. Mounted nowhere until PR 12/13.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person, sequence, sequenceMember } from "@/db/schema";
import { sequenceAuditRow } from "./approvalAudit";
import { normalizeSuppressionValue } from "./suppression";
import { suppressAddressInTx } from "./unsubscribeQueries";

export type OptOutResult = { ok: true; discarded: number } | { ok: false; error: "not_found" | "no_email" };

/** `bdId` must own the member's Sequence. A Contact with no email cannot be suppressed by address, so it is refused, not guessed. */
export async function recordOptOutForMember(bdId: string, memberId: string): Promise<OptOutResult> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ personId: sequenceMember.personId, email: sql<string | null>`coalesce(${person.emailNormalized}, lower(trim(${person.email})))` })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .innerJoin(person, eq(person.id, sequenceMember.personId))
      .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId)));
    if (!m) return { ok: false, error: "not_found" } as const;
    const email = normalizeSuppressionValue("address", m.email ?? "");
    if (!email.includes("@")) return { ok: false, error: "no_email" } as const;

    const discarded = await suppressAddressInTx(tx, { email, source: "reply", actorBdId: bdId, personId: m.personId, sequenceMemberId: memberId });
    if (discarded.length > 0) {
      await tx.insert(auditLog).values(discarded.map((d) => sequenceAuditRow("opt_out", { actorBdId: bdId, personId: d.personId, memberId: d.id, sequenceId: d.sequenceId })));
    }
    return { ok: true, discarded: discarded.length } as const;
  });
}
