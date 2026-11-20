import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, tenderDocument, tenderPortal } from "@/db/schema";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { isUuid } from "@/lib/uuid";
import { normalizeNote } from "./note";
import { toTenderAnalysis, type TenderAnalysis } from "./analysis";
import type { BdOption, TenderDetail, TenderEventKind } from "./detail";
import { tenderTiming } from "./timing";
import { isRequirementKey, isRequirementStatus, type RequirementKey, type RequirementStatus, type RequirementStatuses } from "./requirementStatus";

/** The log shows the most recent movements; a tender worked over months stays well under this. */
export const TENDER_EVENT_LIMIT = 100;
interface RawDocument {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string | null;
  analysis: unknown;
  analyzedAt: string | null;
  analyzedBy: string | null;
}
interface RawEvent {
  id: string;
  kind: string;
  detail: TenderDetail["events"][number]["detail"];
  createdAt: string;
  actor: string | null;
}

// Literal `tender.id`, not an interpolated column: a reused Column inside a nested raw subquery renders unqualified in this
// drizzle version and the correlation silently becomes always-false (PERFORMANCE.md).
const documentsJson = sql`(
  select coalesce(json_agg(x order by x."createdAt" desc), '[]'::json) from (
    select d.id, d.filename, d.size_bytes as "sizeBytes", d.created_at as "createdAt", u.name as "uploadedBy",
           d.analysis, d.analyzed_at as "analyzedAt", a.name as "analyzedBy"
    from tender_document d
    left join bd u on u.id = d.uploaded_by_bd_id
    left join bd a on a.id = d.analyzed_by_bd_id
    where d.tender_id = tender.id
  ) x)`;
const eventsJson = sql`(
  select coalesce(json_agg(y order by y."createdAt" desc), '[]'::json) from (
    select e.id, e.kind, e.detail, e.created_at as "createdAt", b.name as actor
    from tender_event e
    left join bd b on b.id = e.actor_bd_id
    where e.tender_id = tender.id
    order by e.created_at desc
    limit ${TENDER_EVENT_LIMIT}
  ) y)`;

const requirementStatusJson = sql`(select coalesce(json_object_agg(r.requirement_key, r.status), '{}'::json) from tender_requirement_status r where r.tender_id = tender.id)`;

const bdOptionsJson = sql`(select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::json) from bd b where b.role = 'admin')`;

/**
 * Everything the ficha shows in ONE round trip: the tender row with its documents and its log as two json subqueries.
 * Timestamps inside the json arrive as strings and are turned back into Dates here. Null when the id matches nothing or
 * is not a uuid.
 */
export async function getTenderDetail(id: string, now: Date = new Date(), database: Pick<typeof db, "select"> = db): Promise<TenderDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await database
    .select({ t: tender, portal: tenderPortal, docs: documentsJson.mapWith((v) => v as RawDocument[]), events: eventsJson.mapWith((v) => v as RawEvent[]), bds: bdOptionsJson.mapWith((v) => v as BdOption[]), statuses: requirementStatusJson.mapWith((v) => v as Record<string, string>) })
    .from(tender)
    .leftJoin(tenderPortal, eq(tenderPortal.tenderId, tender.id))
    .where(eq(tender.id, id))
    .limit(1);
  if (!row) return null;
  return {
    tender: { ...row.t, ...tenderTiming(row.t.openingAt, now) },
    portal: row.portal,
    bdOptions: row.bds,
    // Same round trip as the rest; a row whose key or value is not one we know (hand-edited) is dropped rather than shown.
    requirementStatuses: Object.fromEntries(Object.entries(row.statuses).filter(([k, v]) => isRequirementKey(k) && (v === "have" || v === "missing"))) as RequirementStatuses,
    documents: row.docs.map((d) => ({
      ...d,
      createdAt: parseDbTimestamp(d.createdAt),
      analysis: toTenderAnalysis(d.analysis),
      analyzedAt: d.analyzedAt ? parseDbTimestamp(d.analyzedAt) : null,
    })),
    events: row.events.map((e) => ({ ...e, kind: e.kind as TenderEventKind, createdAt: parseDbTimestamp(e.createdAt) })),
  };
}

/** Rows of a raw `db.execute`: postgres-js returns the array itself. */
const rowsOf = <T>(r: unknown) => r as T[];

// `clock_timestamp()`, not `now()`: inside one transaction `now()` is frozen, and two entries written together must still
// sort in the order they happened.
/** Saves (or clears) the note and logs it, in ONE statement; an unchanged note writes nothing and logs nothing. False when the tender does not exist. */
export async function saveTenderNote(id: string, raw: string, actorBdId: string, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  if (!isUuid(id)) return false;
  const note = normalizeNote(raw);
  const rows = rowsOf<{ found: number }>(
    await database.execute(sql`
      with old as (select note from tender where id = ${id}::uuid),
      upd as (update tender set note = ${note}::text, updated_at = now() where id = ${id}::uuid returning id),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select upd.id, ${actorBdId}::uuid, 'note', jsonb_build_object('text', coalesce(${note}::text, '')), clock_timestamp()
        from upd, old where old.note is distinct from ${note}::text
        returning 1
      )
      select (select count(*) from upd)::int as found`),
  );
  return (rows[0]?.found ?? 0) > 0;
}

/** Registers an uploaded pliego as the tender's newest document and logs it, in ONE statement. Null when the tender does not exist. */
export async function addTenderDocument(
  input: { tenderId: string; storagePath: string; filename: string; sizeBytes: number; actorBdId: string },
  database: Pick<typeof db, "execute"> = db,
): Promise<string | null> {
  if (!isUuid(input.tenderId)) return null;
  const rows = rowsOf<{ id: string }>(
    await database.execute(sql`
      with doc as (
        insert into tender_document (tender_id, storage_path, filename, size_bytes, uploaded_by_bd_id, created_at)
        select t.id, ${input.storagePath}, ${input.filename}, ${input.sizeBytes}::int, ${input.actorBdId}::uuid, clock_timestamp()
        from tender t where t.id = ${input.tenderId}::uuid
        returning id, tender_id
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select doc.tender_id, ${input.actorBdId}::uuid, 'document', jsonb_build_object('filename', ${input.filename}::text), clock_timestamp() from doc
        returning 1
      )
      select id from doc`),
  );
  return rows[0]?.id ?? null;
}

/** The document the analysis must read: the newest upload of the tender, or null when there is none. */
export async function getCurrentTenderDocument(tenderId: string, database: Pick<typeof db, "select"> = db) {
  if (!isUuid(tenderId)) return null;
  const [row] = await database.select().from(tenderDocument).where(eq(tenderDocument.tenderId, tenderId)).orderBy(desc(tenderDocument.createdAt)).limit(1);
  return row ?? null;
}

/** Stores the reading ON the document it came from and logs it, in ONE statement. False when the document no longer exists. */
export async function saveTenderAnalysis(documentId: string, analysis: TenderAnalysis, actorBdId: string, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  if (!isUuid(documentId)) return false;
  const rows = rowsOf<{ id: string }>(
    await database.execute(sql`
      with upd as (
        update tender_document set analysis = ${JSON.stringify(analysis)}::jsonb, analyzed_at = clock_timestamp(), analyzed_by_bd_id = ${actorBdId}::uuid
        where id = ${documentId}::uuid returning id, tender_id, filename
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select upd.tender_id, ${actorBdId}::uuid, 'analysis', jsonb_build_object('filename', upd.filename), clock_timestamp() from upd
        returning 1
      )
      select id from upd`),
  );
  return rows.length > 0;
}

/**
 * Assigns the tender to a BD, or releases it with `null`, and logs who did it in ONE statement. The log keeps the owner's NAME
 * as it was then, so the history survives a rename or a deleted BD. Choosing the current owner writes nothing and logs nothing.
 * False when the tender does not exist, or the BD does not or is not an admin (the section is admin-only, so a non-admin owner
 * would hold a tender they cannot open).
 */
export async function setTenderOwner(id: string, ownerBdId: string | null, actorBdId: string, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  if (!isUuid(id) || (ownerBdId !== null && !isUuid(ownerBdId))) return false;
  const rows = rowsOf<{ found: number }>(
    await database.execute(sql`
      with old as (select owner_bd_id from tender where id = ${id}::uuid),
      who as (select name from bd where id = ${ownerBdId}::uuid and role = 'admin'),
      upd as (
        update tender set owner_bd_id = ${ownerBdId}::uuid, updated_at = now()
        where id = ${id}::uuid and (${ownerBdId}::uuid is null or exists (select 1 from who)) returning id
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select upd.id, ${actorBdId}::uuid, 'owner', jsonb_build_object('to', coalesce((select name from who), '')), clock_timestamp()
        from upd, old where old.owner_bd_id is distinct from ${ownerBdId}::uuid
        returning 1
      )
      select (select count(*) from upd)::int as found`),
  );
  return (rows[0]?.found ?? 0) > 0;
}

/**
 * Records what administration answered for ONE requirement, keyed by its stable key (never its text), and logs it, in ONE statement.
 * 'pending' deletes the row: the table holds decisions only, and no row IS pending. The existing `note` survives a change of
 * state. Choosing the current state writes and logs nothing. False when the tender does not exist or the key/state is unknown.
 */
export async function setRequirementStatus(
  tenderId: string,
  key: RequirementKey,
  status: RequirementStatus,
  actorBdId: string,
  database: Pick<typeof db, "execute"> = db,
): Promise<boolean> {
  if (!isUuid(tenderId) || !isRequirementKey(key) || !isRequirementStatus(status)) return false;
  const rows = rowsOf<{ found: number }>(
    await database.execute(sql`
      with t as (select id from tender where id = ${tenderId}::uuid),
      old as (select status from tender_requirement_status where tender_id = ${tenderId}::uuid and requirement_key = ${key}),
      del as (
        delete from tender_requirement_status where tender_id = ${tenderId}::uuid and requirement_key = ${key} and ${status} = 'pending' returning 1
      ),
      ups as (
        insert into tender_requirement_status (tender_id, requirement_key, status, set_by_bd_id, updated_at)
        select t.id, ${key}, ${status}, ${actorBdId}::uuid, clock_timestamp() from t where ${status} <> 'pending'
        on conflict (tender_id, requirement_key) do update set status = excluded.status, set_by_bd_id = excluded.set_by_bd_id, updated_at = excluded.updated_at
        returning 1
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select t.id, ${actorBdId}::uuid, 'requirement', jsonb_build_object('key', ${key}::text, 'to', ${status}::text), clock_timestamp()
        from t where coalesce((select status from old), 'pending') <> ${status}
        returning 1
      )
      select (select count(*) from t)::int as found`),
  );
  return (rows[0]?.found ?? 0) > 0;
}
