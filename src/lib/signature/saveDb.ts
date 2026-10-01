import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd } from "@/db/schema";
import { buildSignatureAuditRow } from "@/lib/signature/audit";

/**
 * Stores (or clears, with `null`) the signed-in BD's own signature and logs
 * who did it, atomically: an audit row never exists without the change, nor
 * the change without its audit row. The WHERE is the actor's own id, so a BD
 * can only ever write their own signature.
 */
export async function saveOwnSignature(actorBdId: string, before: string | null, after: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(bd).set({ signatureHtml: after }).where(eq(bd.id, actorBdId));
    await tx.insert(auditLog).values(buildSignatureAuditRow({ actorBdId, before, after }));
  });
}
