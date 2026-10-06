/**
 * Thin DB layer for scripts/extract-signature-phones.ts. Not unit-tested
 * directly (importing `@/db` throws without DATABASE_URL); every branch worth
 * testing lives in extract.ts / plan.ts / analyze.ts.
 *
 * ONE read per run: inbound messages joined to their person. ATTRIBUTION: the
 * sync (src/lib/gmail/classify.ts) sets email_message.person_id for an inbound
 * message only from the From address, but that link is a snapshot, so the read
 * re-checks it live: the row counts only when lower(from_address) still equals
 * the person's email_normalized and the person is not merged. Otherwise the
 * body is not even shipped. Execute rebuilds the plan INSIDE its transaction
 * and re-guards each fill in SQL, so a number added since the read is never
 * overwritten. The dry run is a READ ONLY transaction. No persons are created,
 * so the identity lock is not needed.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, personPropertyHistory } from "@/db/schema";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { analyzeCandidates, type CandidateRow, type SignatureReport } from "./analyze";
import type { SignaturePhonePlan } from "./plan";

export const SIGNATURE_AUDIT_ACTION = "extract_signature_phones";
export const SIGNATURE_HISTORY_SOURCE = "signature_extract";
const ROW_CAP = 20_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Raw = { message_id: string; person_id: string; attributed: boolean; phone: string | null; mobile_phone: string | null; body_text: string | null };

async function readCandidates(tx: DbTransaction, limit: number | null): Promise<CandidateRow[]> {
  const rows = (await tx.execute(sql`
    select m.id::text as message_id, m.person_id::text as person_id,
      (p.merged_into_id is null and p.email_normalized is not null and lower(btrim(m.from_address)) = p.email_normalized) as attributed,
      p.phone, p.mobile_phone,
      case when p.merged_into_id is null and p.email_normalized is not null and lower(btrim(m.from_address)) = p.email_normalized then m.body_text end as body_text
    from email_message m
    join person p on p.id = m.person_id
    where m.direction = 'inbound' and btrim(coalesce(m.body_text, '')) <> ''
    order by m.sent_at, m.id
    limit ${limit ?? ROW_CAP + 1}
  `)) as unknown as Raw[];
  if (limit === null && rows.length > ROW_CAP) throw new Error(`More than ${ROW_CAP} inbound messages: pass --limit=<n> for a bounded run.`);
  return rows.map((r) => ({ messageId: r.message_id, personId: r.person_id, attributed: Boolean(r.attributed), phone: r.phone, mobilePhone: r.mobile_phone, body: r.body_text }));
}

export async function dryRunSignaturePhones(limit: number | null): Promise<{ plan: SignaturePhonePlan; report: SignatureReport }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return analyzeCandidates(await readCandidates(tx, limit));
  });
}

export async function executeSignaturePhones(actorBdId: string, limit: number | null): Promise<{ plan: SignaturePhonePlan; report: SignatureReport; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) => {
    const { plan, report } = analyzeCandidates(await readCandidates(tx, limit));
    if (!plan.fills.length) return { plan, report, auditLogId: null };
    for (const f of plan.fills) if (!isUuid(f.personId)) throw new Error(`Planned fill target is not a uuid: ${f.personId}`);

    // One row per person (a person can get both columns), so the UPDATE ... FROM matches each id once.
    const targets = new Map<string, { phone: string | null; mobile: string | null }>();
    for (const f of plan.fills) {
      const t = targets.get(f.personId) ?? { phone: null, mobile: null };
      targets.set(f.personId, t);
      if (f.column === "phone") t.phone = f.value;
      else t.mobile = f.value;
    }
    for (const batch of chunk([...targets], WRITE_BATCH_SIZE)) {
      const values = batch.map(([id, t]) => sql`(${id}::uuid, ${t.phone}::text, ${t.mobile}::text)`);
      // Fill-empty per column, guarded again in SQL: a number added since the read is never overwritten.
      const updated = (await tx.execute(sql`
        update person as p
        set phone = case when btrim(coalesce(p.phone, '')) = '' then v.phone else p.phone end,
            mobile_phone = case when btrim(coalesce(p.mobile_phone, '')) = '' then v.mobile_phone else p.mobile_phone end,
            updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        from (values ${sql.join(values, sql`, `)}) as v(id, phone, mobile_phone)
        where p.id = v.id and p.merged_into_id is null
          and (v.phone is null or btrim(coalesce(p.phone, '')) = '')
          and (v.mobile_phone is null or btrim(coalesce(p.mobile_phone, '')) = '')
        returning p.id::text as id
      `)) as unknown as { id: string }[];
      if (updated.length !== batch.length) throw new Error(`Expected to fill ${batch.length} contacts, filled ${updated.length}: a phone appeared since the plan was built.`);
    }
    for (const batch of chunk(plan.fills, WRITE_BATCH_SIZE)) {
      await tx.insert(personPropertyHistory).values(batch.map((f) => ({ personId: f.personId, property: f.column, oldValue: null, newValue: f.value, changedByBdId: actorBdId, source: SIGNATURE_HISTORY_SOURCE })));
    }
    const [audit] = await tx
      .insert(auditLog)
      .values({
        actorBdId,
        action: SIGNATURE_AUDIT_ACTION,
        // Revert: see the header of scripts/extract-signature-phones.ts. supportingMessages is the audit trail of agreement.
        metadata: { report, fills: plan.fills.map((f) => ({ personId: f.personId, column: f.column, supportingMessages: f.supportingMessages, ...(f.landlineInferred ? { landlineInferred: true } : {}) })) },
      })
      .returning({ id: auditLog.id });
    return { plan, report, auditLogId: audit!.id };
  });
}
